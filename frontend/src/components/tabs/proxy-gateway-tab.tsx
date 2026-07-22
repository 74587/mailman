'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
    ArrowLeft,
    BookOpen,
    ChevronsLeft,
    ChevronsRight,
    Code2,
    Copy,
    FileDown,
    FileText,
    GitBranch,
    HelpCircle,
    KeyRound,
    ListFilter,
    Loader2,
    Network,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Server,
    ShieldCheck,
    SlidersHorizontal,
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
    ProxyGatewayTargetRoute,
    ProxyGatewayValidationResult,
    toStringList,
} from '@/services/proxy-gateway.service'
import { ProxyGroup, ProxyPoolItem, ProxyTag } from '@/types'

type ProxyGatewaySection = 'gateways' | 'listeners' | 'accounts' | 'account-groups' | 'account-tags' | 'routes' | 'security' | 'dns' | 'logs' | 'status'
type NormalizedSection = 'gateways' | 'accounts' | 'account-groups' | 'account-tags' | 'logs'
type GatewayDetailSection = 'overview' | 'target-routes' | 'routes' | 'security' | 'dns' | 'logs'
type AccountStep = 'identity' | 'authorization' | 'routing' | 'source' | 'proxy' | 'fallback' | 'limits'
type RouteStep = 'basic' | 'proxy' | 'fallback' | 'overrides'
type SecurityStep = 'basic' | 'sources' | 'targets' | 'boundaries'
type StrategySection = 'selection' | 'fallback'

interface ProxyGatewayTabProps {
    section?: ProxyGatewaySection
}

type AccountDraft = Partial<ProxyGatewayAccount> & { password?: string; tagIds?: number[] }
type MetaDraft = { id?: number; type: 'group' | 'tag'; name: string; description?: string; color?: string; sortOrder?: number }
type SearchOption = { id: number; name: string; description?: string; color?: string; meta?: string }
type ProxyExportProtocol = 'http' | 'socks5'
type ProxyExportIndexMode = 'sequential' | 'random'
type ProxyExportFormat = 'url' | 'auth-at-host' | 'host-port-auth' | 'host-port-at-auth' | 'auth-host-port' | 'csv' | 'tsv' | 'jsonl'
type GatewayLogTargetMatch = 'wildcard' | 'regex'

type GatewayLogFilters = {
    startTime: string
    endTime: string
    sourceIp: string
    target: string
    targetMatch: GatewayLogTargetMatch
    status: string
    accountId: string
    accountName: string
}

const emptyGatewayLogFilters = (): GatewayLogFilters => ({
    startTime: '',
    endTime: '',
    sourceIp: '',
    target: '',
    targetMatch: 'wildcard',
    status: '',
    accountId: '',
    accountName: '',
})

const proxyExportFormatOptions: Array<[ProxyExportFormat, string]> = [
    ['url', '协议://用户:密码@地址:端口'],
    ['auth-at-host', '用户:密码@地址:端口'],
    ['host-port-auth', '地址:端口:用户:密码'],
    ['host-port-at-auth', '地址:端口@用户:密码'],
    ['auth-host-port', '用户:密码:地址:端口'],
    ['csv', 'CSV（协议,地址,端口,用户,密码）'],
    ['tsv', 'TSV（制表符分隔）'],
    ['jsonl', 'JSON Lines'],
]

const proxyGatewayGuideHref = '/guide-html/proxy-pool-management.html#usage'

const sectionMeta: Record<NormalizedSection, { title: string; subtitle: string; icon: any }> = {
    gateways: { title: '代理网关', subtitle: '先创建 HTTP / SOCKS5 / Mixed 网关，再在网关下维护路由、安全和 DNS 策略', icon: Network },
    accounts: { title: '网关用户', subtitle: '独立于 Mailman 用户体系，配置认证、网关授权、出口来源和使用限制', icon: KeyRound },
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
    usernameRouteSeparators: ['#'],
})

const defaultAccount = (defaultGatewayId?: number): AccountDraft => ({
    username: '',
    password: '',
    name: '',
    remark: '',
    enabled: true,
    allowAllGateways: false,
    allowedGatewayIds: defaultGatewayId ? [defaultGatewayId] : [],
    proxySelectionSource: 'gateway',
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
    usernameRoutingMode: 'proxy_index',
    proxyIndexOverflowMode: 'reject',
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
    proxyIndexOverflowMode: 'reject',
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

function nextRouteStrategyFlag(strategies: ProxyGatewayRouteStrategy[], gatewayId: number) {
    const used = new Set(strategies.filter(item => item.gatewayId === gatewayId).map(item => item.flagNo))
    let flagNo = 1
    while (used.has(flagNo)) flagNo += 1
    return flagNo
}

const defaultTargetRoute = (gatewayId: number, routeStrategyId?: number): Partial<ProxyGatewayTargetRoute> => ({
    gatewayId,
    name: '目标路由',
    description: '',
    enabled: true,
    isDefault: false,
    sortOrder: 100,
    matchers: [],
    routeStrategyId,
    failoverEnabled: false,
    failureThreshold: 2,
    failureWindowSeconds: 30,
    circuitBaseSeconds: 60,
    circuitMaxSeconds: 300,
    circuitBackoffMultiplier: 2,
    circuitJitterPercent: 10,
    circuitHalfOpenProbes: 1,
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
    const [targetRoutes, setTargetRoutes] = useState<ProxyGatewayTargetRoute[]>([])
    const [securityPolicies, setSecurityPolicies] = useState<ProxyGatewaySecurityPolicy[]>([])
    const [dnsPolicies, setDnsPolicies] = useState<ProxyGatewayDNSPolicy[]>([])
    const [auditLogs, setAuditLogs] = useState<ProxyGatewayAuditLog[]>([])
    const [statuses, setStatuses] = useState<ProxyGatewayStatus[]>([])
    const [proxyGroups, setProxyGroups] = useState<ProxyGroup[]>([])
    const [proxyTags, setProxyTags] = useState<ProxyTag[]>([])
    const [proxies, setProxies] = useState<ProxyPoolItem[]>([])

    const [listenerDraft, setListenerDraft] = useState<Partial<ProxyGatewayListener> | null>(null)
    const [accountDraft, setAccountDraft] = useState<AccountDraft | null>(null)
    const [routeDraft, setRouteDraft] = useState<Partial<ProxyGatewayRouteStrategy> | null>(null)
    const [targetRouteDraft, setTargetRouteDraft] = useState<Partial<ProxyGatewayTargetRoute> | null>(null)
    const [securityDraft, setSecurityDraft] = useState<Partial<ProxyGatewaySecurityPolicy> | null>(null)
    const [dnsDraft, setDNSDraft] = useState<Partial<ProxyGatewayDNSPolicy> | null>(null)
    const [metaDraft, setMetaDraft] = useState<MetaDraft | null>(null)

    const safeListeners = useMemo(() => asArray<ProxyGatewayListener>(listeners), [listeners])
    const safeAccounts = useMemo(() => asArray<ProxyGatewayAccount>(accounts), [accounts])
    const safeAccountGroups = useMemo(() => asArray<ProxyGatewayAccountGroup>(accountGroups), [accountGroups])
    const safeAccountTags = useMemo(() => asArray<ProxyGatewayAccountTag>(accountTags), [accountTags])
    const safeRouteStrategies = useMemo(() => asArray<ProxyGatewayRouteStrategy>(routeStrategies), [routeStrategies])
    const safeTargetRoutes = useMemo(() => asArray<ProxyGatewayTargetRoute>(targetRoutes), [targetRoutes])
    const safeSecurityPolicies = useMemo(() => asArray<ProxyGatewaySecurityPolicy>(securityPolicies), [securityPolicies])
    const safeDNSPolicies = useMemo(() => asArray<ProxyGatewayDNSPolicy>(dnsPolicies), [dnsPolicies])
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
                proxyGatewayService.listAuditLogs(80),
                proxyGatewayService.status(),
                proxyPoolService.listGroups(),
                proxyPoolService.listTags(),
                proxyPoolService.list({ limit: 500, status: 'available' }),
            ])
            const listenerItems = asArray<ProxyGatewayListener>(nextListeners)
            const accountItems = asArray<ProxyGatewayAccount>((accountResponse as any)?.items)
            const proxyItems = asArray<ProxyPoolItem>((proxyResponse as any)?.items)
            const nextGatewayId = selectedGatewayId && listenerItems.some(item => item.id === selectedGatewayId)
                ? selectedGatewayId
                : listenerItems.find(item => item.isDefault)?.id || listenerItems[0]?.id || 0
            const [nextRoutes, nextTargetRoutes, nextSecurity, nextDNS] = nextGatewayId
                ? await Promise.all([
                    proxyGatewayService.listRouteStrategies(),
                    proxyGatewayService.listTargetRoutes({ gatewayId: nextGatewayId }),
                    proxyGatewayService.listSecurityPolicies({ gatewayId: nextGatewayId }),
                    proxyGatewayService.listDNSPolicies({ gatewayId: nextGatewayId }),
                ])
                : [[], [], [], []]

            setListeners(listenerItems)
            setSelectedGatewayId(nextGatewayId)
            setAccounts(accountItems)
            setAccountGroups(asArray<ProxyGatewayAccountGroup>(nextAccountGroups))
            setAccountTags(asArray<ProxyGatewayAccountTag>(nextAccountTags))
            setRouteStrategies(asArray<ProxyGatewayRouteStrategy>(nextRoutes))
            setTargetRoutes(asArray<ProxyGatewayTargetRoute>(nextTargetRoutes))
            setSecurityPolicies(asArray<ProxyGatewaySecurityPolicy>(nextSecurity))
            setDnsPolicies(asArray<ProxyGatewayDNSPolicy>(nextDNS))
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
            toast.success('出口策略已保存')
        } catch (error: any) {
            toast.error(error.message || '保存失败')
        }
    }

    const saveTargetRoute = async () => {
        if (!targetRouteDraft) return
        const payload = { ...targetRouteDraft, gatewayId: targetRouteDraft.gatewayId || currentGatewayId }
        if (!payload.routeStrategyId) {
            toast.error('请选择出口策略')
            return
        }
        if (payload.failoverEnabled) {
            if (!payload.fallbackRouteStrategyId) {
                toast.error('请选择失败切换的兜底出口策略')
                return
            }
            if (payload.fallbackRouteStrategyId === payload.routeStrategyId) {
                toast.error('兜底出口策略不能与主出口策略相同')
                return
            }
            if ((payload.circuitMaxSeconds || 0) < (payload.circuitBaseSeconds || 0)) {
                toast.error('最大退避时间不能小于初始退避时间')
                return
            }
        }
        if (!payload.isDefault && !(payload.matchers || []).length) {
            toast.error('非默认规则至少需要一个域名、IP 或 CIDR')
            return
        }
        try {
            if (payload.id) {
                await proxyGatewayService.updateTargetRoute(payload.id, payload)
            } else {
                await proxyGatewayService.createTargetRoute(payload)
            }
            setTargetRouteDraft(null)
            await loadData()
            toast.success('目标路由已保存并生效')
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
                                    targetRoutes={safeTargetRoutes}
                                    securityPolicies={safeSecurityPolicies}
                                    dnsPolicies={safeDNSPolicies}
                                    accounts={safeAccounts}
                                    onReload={reloadGateway}
                                    onEditGateway={item => setListenerDraft({ ...item })}
                                    onDeleteGateway={async item => {
                                        if (!(await confirm.confirm({ title: '删除代理网关', description: `确认删除 ${item.name}？网关下的策略将不可继续使用。` }))) return
                                        await proxyGatewayService.deleteListener(item.id)
                                        await loadData()
                                    }}
                                    onCreateRoute={() => currentGatewayId && setRouteDraft({
                                        ...defaultRouteStrategy(currentGatewayId),
                                        flagNo: nextRouteStrategyFlag(safeRouteStrategies, currentGatewayId),
                                    })}
                                    onEditRoute={item => setRouteDraft({ ...item })}
                                    onDeleteRoute={async item => {
                                        if (!(await confirm.confirm({ title: '删除出口策略', description: `确认删除 ${item.name}？引用它的目标路由需要先删除，已授权账号也将无法继续使用 ?route=${item.flagNo}（兼容账号为 #${item.flagNo}）。` }))) return
                                        await proxyGatewayService.deleteRouteStrategy(item.id)
                                        await loadData()
                                    }}
                                    onCreateTargetRoute={() => {
                                        if (!currentGatewayId) return
                                        const firstStrategy = safeRouteStrategies.find(item => item.enabled && (item.gatewayId === currentGatewayId || item.gatewayId === 0))
                                        setTargetRouteDraft(defaultTargetRoute(currentGatewayId, firstStrategy?.id))
                                    }}
                                    onEditTargetRoute={item => setTargetRouteDraft({ ...item, matchers: [...(item.matchers || [])] })}
                                    onDeleteTargetRoute={async item => {
                                        if (!(await confirm.confirm({ title: '删除目标路由', description: `确认删除 ${item.name}？新的连接将不再使用这条规则。` }))) return
                                        await proxyGatewayService.deleteTargetRoute(item.id)
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
                            {normalizedSection === 'logs' && <LogsView auditLogs={safeAuditLogs} />}
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
                <TargetRouteModal draft={targetRouteDraft} setDraft={setTargetRouteDraft} routeStrategies={safeRouteStrategies.filter(item => item.gatewayId === currentGatewayId || item.gatewayId === 0)} onSave={saveTargetRoute} />
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
    return <div className="min-w-0 rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">{children}</div>
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
    targetRoutes,
    securityPolicies,
    dnsPolicies,
    accounts,
    onReload,
    onEditGateway,
    onDeleteGateway,
    onCreateRoute,
    onEditRoute,
    onDeleteRoute,
    onCreateTargetRoute,
    onEditTargetRoute,
    onDeleteTargetRoute,
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
    targetRoutes: ProxyGatewayTargetRoute[]
    securityPolicies: ProxyGatewaySecurityPolicy[]
    dnsPolicies: ProxyGatewayDNSPolicy[]
    accounts: ProxyGatewayAccount[]
    onReload: () => void
    onEditGateway: (item: ProxyGatewayListener) => void
    onDeleteGateway: (item: ProxyGatewayListener) => void
    onCreateRoute: () => void
    onEditRoute: (item: ProxyGatewayRouteStrategy) => void
    onDeleteRoute: (item: ProxyGatewayRouteStrategy) => void
    onCreateTargetRoute: () => void
    onEditTargetRoute: (item: ProxyGatewayTargetRoute) => void
    onDeleteTargetRoute: (item: ProxyGatewayTargetRoute) => void
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
        const gatewayTargetRoutes = targetRoutes.filter(item => item.gatewayId === detailGateway.id)
        const gatewaySecurity = securityPolicies.filter(item => item.gatewayId === detailGateway.id || item.gatewayId === 0)
        const gatewayDNS = dnsPolicies.filter(item => item.gatewayId === detailGateway.id || item.gatewayId === 0)
        const gatewayStatus = statusByListener.get(detailGateway.id)
        const allowedAccounts = accounts.filter(account => account.allowAllGateways || !account.allowedGatewayIds?.length || account.allowedGatewayIds.includes(detailGateway.id))
        const detailMenuItems: Array<{ id: GatewayDetailSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
            { id: 'overview', label: '概览', icon: Server },
            { id: 'target-routes', label: '目标路由', icon: ListFilter },
            { id: 'routes', label: '出口策略', icon: GitBranch },
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
                            targetRouteCount={gatewayTargetRoutes.length}
                            securityCount={gatewaySecurity.length}
                            dnsCount={gatewayDNS.length}
                            onEdit={() => onEditGateway(detailGateway)}
                            onReload={onReload}
                        />
                    )}
                    {detailSection === 'target-routes' && (
                        <Panel>
                            <div className="p-4">
                                <TargetRoutesView routes={gatewayTargetRoutes} strategies={gatewayRoutes} onCreate={onCreateTargetRoute} onEdit={onEditTargetRoute} onDelete={onDeleteTargetRoute} />
                            </div>
                        </Panel>
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
                    {detailSection === 'logs' && <LogsView auditLogs={[]} listenerId={detailGateway.id} />}
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

function GatewayOverview({ gateway, status, allowedAccounts, routeCount, targetRouteCount, securityCount, dnsCount, onEdit, onReload }: {
    gateway: ProxyGatewayListener
    status?: ProxyGatewayStatus
    allowedAccounts: ProxyGatewayAccount[]
    routeCount: number
    targetRouteCount: number
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
                            <Pencil className="h-4 w-4" />
                            编辑网关
                        </button>
                    </div>
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                    <Metric label="授权用户" value={allowedAccounts.length} />
                    <Metric label="目标路由" value={targetRouteCount} />
                    <Metric label="出口策略" value={routeCount} />
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
                    <SummaryRow label="用户名路由分隔符" value={gatewayUsernameRouteSeparators(gateway).join('  ')} />
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
    const [exampleAccount, setExampleAccount] = useState<ProxyGatewayAccount | null>(null)
    const [exportAccount, setExportAccount] = useState<ProxyGatewayAccount | null>(null)
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
                                <th className="px-4 py-3 text-left">出口来源</th>
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
                                            {item.enableUsernameRouting && (
                                                <Badge tone="amber">{(item.usernameRoutingMode || 'strategy') === 'proxy_index' ? '池内索引' : '策略编号'}</Badge>
                                            )}
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
                                        {(item.proxySelectionSource || 'account') === 'gateway' ? (
                                            <div>
                                                <Badge tone="green">遵循网关</Badge>
                                                <div className="mt-1 text-xs text-gray-500">目标路由 / 默认出口</div>
                                            </div>
                                        ) : (
                                            <div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    <Badge tone="amber">独立配置</Badge>
                                                    <Badge tone="blue">{item.selectionMode}</Badge>
                                                    <Badge>{item.selectionAlgorithm}</Badge>
                                                    {item.preferLastSuccess && <Badge tone="green">优先复用</Badge>}
                                                    {item.stickyMode !== 'none' && <Badge tone="amber">{item.stickyMode}</Badge>}
                                                </div>
                                                <div className="mt-1 text-xs text-gray-500">兼容模式</div>
                                            </div>
                                        )}
                                        {item.enableUsernameRouting && (item.usernameRoutingMode || 'strategy') === 'proxy_index' && item.proxyIndexOverflowMode === 'modulo' && (
                                            <div className="mt-1"><Badge tone="green">索引取模</Badge></div>
                                        )}
                                        {item.enableUsernameRouting && (item.usernameRoutingMode || 'strategy') === 'strategy' && !item.allowAllRouteStrategies && (
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
                                            <a
                                                href={proxyGatewayGuideHref}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                                                title="打开使用文档"
                                                aria-label="打开使用文档"
                                            >
                                                <BookOpen className="h-4 w-4" />
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => setExampleAccount(item)}
                                                className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                                                title="查看接入代码"
                                                aria-label="查看接入代码"
                                            >
                                                <Code2 className="h-4 w-4" />
                                            </button>
                                            {item.enableUsernameRouting && (
                                                <button
                                                    type="button"
                                                    onClick={() => setExportAccount(item)}
                                                    className="rounded-lg border border-blue-200 p-2 text-blue-600 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950/30"
                                                    title="批量导出智能路由代理"
                                                    aria-label="批量导出智能路由代理"
                                                >
                                                    <FileDown className="h-4 w-4" />
                                                </button>
                                            )}
                                            <RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </TableShell>
            </Panel>
            <AccountCodeExamplesModal account={exampleAccount} onClose={() => setExampleAccount(null)} />
            <AccountProxyExportModal account={exportAccount} gateways={gateways} routeStrategies={routeStrategies} onClose={() => setExportAccount(null)} />
        </>
    )
}

function AccountProxyExportModal({ account, gateways, routeStrategies, onClose }: {
    account: ProxyGatewayAccount | null
    gateways: ProxyGatewayListener[]
    routeStrategies: ProxyGatewayRouteStrategy[]
    onClose: () => void
}) {
    const [gatewayId, setGatewayId] = useState<number | undefined>()
    const [protocol, setProtocol] = useState<ProxyExportProtocol>('http')
    const [separator, setSeparator] = useState('#')
    const [quantity, setQuantity] = useState(0)
    const [indexMode, setIndexMode] = useState<ProxyExportIndexMode>('sequential')
    const [randomSeed, setRandomSeed] = useState(1)
    const [format, setFormat] = useState<ProxyExportFormat>('url')

    const allowedGateways = useMemo(() => {
        if (!account) return []
        const allowedIds = new Set(account.allowedGatewayIds || [])
        return gateways.filter(gateway => {
            const authorized = account.allowAllGateways || !allowedIds.size || allowedIds.has(gateway.id)
            return authorized && gateway.enabled && gateway.requireAuth !== false
        })
    }, [account, gateways])

    useEffect(() => {
        if (!account) {
            setGatewayId(undefined)
            return
        }
        setGatewayId(current => current && allowedGateways.some(gateway => gateway.id === current) ? current : allowedGateways[0]?.id)
    }, [account, allowedGateways])

    const selectedGateway = allowedGateways.find(gateway => gateway.id === gatewayId) || allowedGateways[0]
    const supportedProtocols = selectedGateway ? gatewaySupportedExportProtocols(selectedGateway) : []
    const supportedSeparators = selectedGateway ? gatewayUsernameRouteSeparators(selectedGateway) : ['#']
    const effectiveProtocol = supportedProtocols.includes(protocol) ? protocol : supportedProtocols[0]
    const effectiveSeparator = supportedSeparators.includes(separator) ? separator : supportedSeparators[0] || '#'

    useEffect(() => {
        const nextProtocols = selectedGateway ? gatewaySupportedExportProtocols(selectedGateway) : []
        const nextSeparators = selectedGateway ? gatewayUsernameRouteSeparators(selectedGateway) : ['#']
        setProtocol(current => nextProtocols.includes(current) ? current : nextProtocols[0] || 'http')
        setSeparator(nextSeparators[0] || '#')
    }, [selectedGateway])

    const availableStrategies = useMemo(
        () => account && selectedGateway ? accountExportRouteStrategies(account, selectedGateway, routeStrategies) : [],
        [account, selectedGateway, routeStrategies]
    )
    const usesProxyIndex = (account?.usernameRoutingMode || 'strategy') === 'proxy_index'
    const maxExportQuantity = usesProxyIndex ? 5000 : availableStrategies.length

    useEffect(() => {
        setQuantity(usesProxyIndex ? 20 : (availableStrategies.length ? Math.min(availableStrategies.length, 20) : 0))
    }, [account?.id, selectedGateway?.id, usesProxyIndex, availableStrategies.length])

    const routingEntries = useMemo(
        () => {
            if (usesProxyIndex) {
                const numbers = indexMode === 'random'
                    ? createRandomExportNumbers(quantity, randomSeed)
                    : Array.from({ length: quantity }, (_, index) => index + 1)
                return numbers.map(number => ({ key: `index-${number}`, number }))
            }
            const strategies = indexMode === 'random'
                ? shuffleExportValues(availableStrategies, randomSeed)
                : availableStrategies
            return strategies.slice(0, quantity).map(strategy => ({ key: `strategy-${strategy.id}`, number: strategy.flagNo }))
        },
        [availableStrategies, indexMode, quantity, randomSeed, usesProxyIndex]
    )

    if (!account) return null

    const exportLines = selectedGateway && effectiveProtocol
        ? routingEntries.map(entry => formatSmartRouteProxyExport({
            account,
            gateway: selectedGateway,
            protocol: effectiveProtocol,
            separator: effectiveSeparator,
            routingNumber: entry.number,
            format,
        }))
        : []
    const exportText = exportLines.join('\n')
    const canCopy = !!exportText && (!!account.password || selectedGateway?.requireAuth === false)
    const gatewayOptions = toSearchOptions(allowedGateways, gateway => `${gatewayHostPort(gateway)} · ${gateway.protocol.toUpperCase()}`)

    const selectIndexMode = (mode: ProxyExportIndexMode) => {
        setIndexMode(mode)
        if (mode === 'random') setRandomSeed(createRandomExportSeed())
    }

    const copyExport = async () => {
        if (!canCopy) return
        try {
            await writeClipboardText(exportText)
            toast.success(`已复制 ${exportLines.length} 条代理配置`)
        } catch (error: any) {
            toast.error(error.message || '复制失败')
        }
    }

    return (
        <Modal open={!!account} onOpenChange={open => !open && onClose()}>
            <ModalContent
                size="2xl"
                className="w-[calc(100%-1rem)] sm:w-full"
                onOpenAutoFocus={event => event.preventDefault()}
            >
                <ModalHeader className="p-4 pr-12 sm:p-6 sm:pr-12">
                    <ModalTitle>批量导出智能路由代理</ModalTitle>
                    <ModalDescription>
                        {usesProxyIndex
                            ? '生成指定数量的池内代理索引配置；目标路由会先选定代理池，再按索引定位池内代理。'
                            : '按现有兼容模式从已授权策略中生成代理配置；后缀仍表示策略编号。'}
                    </ModalDescription>
                </ModalHeader>
                <ModalBody className="space-y-5 p-4 sm:p-6">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <SearchSelect
                            label="代理网关"
                            help="仅显示已启用、需要认证且该用户有权访问的网关。"
                            items={gatewayOptions}
                            value={selectedGateway?.id}
                            onChange={setGatewayId}
                            placeholder="选择网关"
                            emptyLabel="没有可用于导出的网关"
                            clearable={false}
                        />
                        <NumberField
                            label="生成数量"
                            help={usesProxyIndex
                                ? `最终导出的配置条数，最多 ${maxExportQuantity} 条；它不等于代理池大小。`
                                : `最终导出的配置条数；当前最多可生成 ${maxExportQuantity} 条。`}
                            value={quantity}
                            min={maxExportQuantity ? 1 : 0}
                            max={maxExportQuantity}
                            onChange={value => setQuantity(maxExportQuantity
                                ? Math.max(1, Math.min(Math.trunc(value || 1), maxExportQuantity))
                                : 0)}
                        />
                        <SelectField
                            label="用户名分隔符"
                            help="只能选择该网关实际接受的智能用户名分隔符。"
                            value={effectiveSeparator}
                            onChange={setSeparator}
                            options={supportedSeparators.map(value => [value, value])}
                        />
                        <SelectField
                            label="导出格式"
                            help="URL 会编码凭据；其他文本模板保留原始用户名和密码。IPv6 地址会自动加方括号。"
                            value={format}
                            onChange={value => setFormat(value as ProxyExportFormat)}
                            options={proxyExportFormatOptions}
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <FieldLabel label="代理协议" help="每次只导出一种协议；Mixed 网关可在 HTTP 和 SOCKS5 之间切换。" />
                            <div className="mt-2 inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900" role="radiogroup" aria-label="代理协议">
                                {supportedProtocols.map(item => {
                                    const active = item === effectiveProtocol
                                    return (
                                        <button
                                            key={item}
                                            type="button"
                                            role="radio"
                                            aria-checked={active}
                                            onClick={() => setProtocol(item)}
                                            className={cn(
                                                'min-w-24 rounded-md px-3 py-1.5 text-sm font-medium transition',
                                                active
                                                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                                                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                                            )}
                                        >
                                            {item.toUpperCase()}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                        <div>
                            <FieldLabel
                                label="索引生成"
                                help={usesProxyIndex
                                    ? '顺序模式生成 1 到 N；随机数模式生成 N 个不重复的正整数，适合配合取模循环。'
                                    : '兼容模式按策略标志号升序生成，随机仅改变已授权策略的顺序。'}
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-900" role="radiogroup" aria-label="索引生成方式">
                                    {([['sequential', '顺序'], ['random', usesProxyIndex ? '随机数' : '随机顺序']] as Array<[ProxyExportIndexMode, string]>).map(([value, label]) => {
                                        const active = indexMode === value
                                        return (
                                            <button
                                                key={value}
                                                type="button"
                                                role="radio"
                                                aria-checked={active}
                                                onClick={() => selectIndexMode(value)}
                                                className={cn(
                                                    'min-w-20 rounded-md px-3 py-1.5 text-sm font-medium transition',
                                                    active
                                                        ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                                                        : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                                                )}
                                            >
                                                {label}
                                            </button>
                                        )
                                    })}
                                </div>
                                {indexMode === 'random' && (
                                    <button
                                        type="button"
                                        onClick={() => setRandomSeed(createRandomExportSeed())}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                        重新随机
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {usesProxyIndex && indexMode === 'random' && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                            随机数可能超过实际代理池大小；请将目标路由命中的出口策略（或账号自有池）设为“取模循环”，否则越界索引会被拒绝。
                        </div>
                    )}

                    {selectedGateway && (usesProxyIndex || availableStrategies.length > 0) ? (
                        <div>
                            <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                                <div className="min-w-0">
                                    <FieldLabel label="导出预览" />
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                                        <span>共 {exportLines.length} 条</span>
                                        <span aria-hidden="true">·</span>
                                        <span>{indexMode === 'random' ? (usesProxyIndex ? '随机数' : '随机策略顺序') : '顺序索引'}</span>
                                        <div className="flex max-h-14 flex-wrap gap-1 overflow-auto" aria-label={usesProxyIndex ? '已生成池内代理索引' : '已生成策略编号'}>
                                            {routingEntries.map(entry => <Badge key={entry.key} tone="blue">{effectiveSeparator}{entry.number}</Badge>)}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    aria-label="复制导出的代理配置"
                                    disabled={!canCopy}
                                    onClick={copyExport}
                                    className={cn(
                                        'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white',
                                        canCopy ? 'bg-blue-600 hover:bg-blue-700' : 'cursor-not-allowed bg-gray-300 dark:bg-gray-700'
                                    )}
                                >
                                    <Copy className="h-4 w-4" />
                                    复制 {exportLines.length} 条
                                </button>
                            </div>
                            {!account.password && (
                                <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                                    当前用户没有可回显密码，无法生成可直接使用的认证配置。请先编辑用户并重新设置密码。
                                </div>
                            )}
                            <pre className="max-h-72 min-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs leading-5 text-gray-100">
                                <code>{exportText || '请选择网关并设置生成数量。'}</code>
                            </pre>
                        </div>
                    ) : (
                        <EmptyState label={selectedGateway ? '该兼容模式用户在当前网关没有可用的智能路由策略' : '没有可用于导出的已启用认证网关'} />
                    )}
                </ModalBody>
                <ModalFooter className="p-4 sm:p-6">
                    <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">关闭</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function AccountCodeExamplesModal({ account, onClose }: {
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
    const proxyUrls = selectedGateway ? buildGatewayProxyUrlExamples(account, selectedGateway) : []
    const commands = selectedGateway ? buildGatewayCurlCommands(account, selectedGateway) : []
    const codeSnippets = selectedGateway ? buildGatewayCodeSnippets(account, selectedGateway) : []
    const exampleText = [
        ...proxyUrls.map(item => `${item.label}\n${item.value}`),
        ...commands.map(item => `${item.label}\n${item.command}`),
        ...codeSnippets.map(item => `${item.label}\n${item.command}`),
    ].join('\n\n')

    const copyText = async (text: string, successMessage = '内容已复制') => {
        try {
            await writeClipboardText(text)
            toast.success(successMessage)
        } catch (error: any) {
            toast.error(error.message || '复制失败')
        }
    }

    return (
        <Modal open={!!account} onOpenChange={open => !open && onClose()}>
            <ModalContent size="6xl">
                <ModalHeader>
                    <ModalTitle>代理接入代码示例</ModalTitle>
                    <ModalDescription>选择该用户可用的网关，生成可直接复制的代理 URL、curl 和程序接入片段。</ModalDescription>
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
                                <FieldLabel label="示例网关" help="打开弹窗时实时调用接口获取网关，再按该账号授权范围过滤。" />
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
                                clearable={false}
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
                                    <FieldLabel label="代理 URL" help="用于需要直接填写完整代理地址的工具；用户名和密码已按 URL 规则编码。" />
                                    <button disabled={!exampleText} onClick={() => copyText(exampleText, '全部示例已复制')} className={cn('inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700', exampleText ? 'hover:bg-gray-50 dark:hover:bg-gray-800' : 'cursor-not-allowed opacity-60')}>
                                        <Copy className="h-4 w-4" />
                                        复制全部
                                    </button>
                                </div>
                                <div className="grid gap-3 lg:grid-cols-2">
                                    {proxyUrls.map(item => (
                                        <CopyExampleBlock key={item.label} item={{ ...item, command: item.value }} copyText={copyText} />
                                    ))}
                                </div>
                            </div>
                            <div>
                                <FieldLabel label="curl 测试命令" help="curl 示例继续使用 --proxy-user 传递原始凭据，适合排查代理连通性。" />
                                <div className="mt-2 grid gap-3 lg:grid-cols-2">
                                    {commands.map(item => (
                                        <CopyExampleBlock key={item.label} item={item} copyText={copyText} />
                                    ))}
                                </div>
                            </div>
                            <div>
                                <FieldLabel label="程序接入片段" help="给脚本、自动化和运行环境配置使用，可按实际协议复制其中一种。" />
                                <div className="mt-2 grid gap-3 lg:grid-cols-2">
                                    {codeSnippets.map(item => (
                                        <CopyExampleBlock key={item.label} item={item} copyText={copyText} />
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <EmptyState label={loadingGateways ? '正在实时获取网关' : '该账号暂无可用网关，无法生成代码示例'} />
                    )}
                </ModalBody>
                <ModalFooter>
                    <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">关闭</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}

function CopyExampleBlock({ item, copyText }: {
    item: { label: string; description: string; command: string }
    copyText: (text: string, successMessage?: string) => void
}) {
    return (
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between gap-3 border-b border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-300">
                <div className="min-w-0">
                    <div className="font-medium text-gray-100">{item.label}</div>
                    <div className="mt-0.5 truncate text-gray-400">{item.description}</div>
                </div>
                <button
                    type="button"
                    onClick={() => copyText(item.command, `${item.label}已复制`)}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-gray-700 px-2 py-1 text-gray-200 hover:bg-gray-800"
                >
                    <Copy className="h-3.5 w-3.5" />
                    复制
                </button>
            </div>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all bg-gray-950 p-3 text-xs text-gray-100">
                <code>{item.command}</code>
            </pre>
        </div>
    )
}

function gatewayUsernameRouteSeparators(gateway: ProxyGatewayListener) {
    const normalized = (gateway.usernameRouteSeparators || []).map(value => value.trim()).filter(Boolean)
    const unique = Array.from(new Set(normalized))
    const valid = unique.length > 0 && unique.length <= 8 && unique.every(value => (
        Array.from(value).length <= 8
        && !/[\s\p{L}\p{Nd}:?;&,]/u.test(value)
        && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    ))
    return valid ? unique : ['#']
}

function gatewaySupportedExportProtocols(gateway: ProxyGatewayListener): ProxyExportProtocol[] {
    if (gateway.protocol === 'mixed') return ['http', 'socks5']
    return [gateway.protocol]
}

function accountExportRouteStrategies(account: ProxyGatewayAccount, gateway: ProxyGatewayListener, routeStrategies: ProxyGatewayRouteStrategy[]) {
    const allowedIds = new Set(account.allowedRouteStrategyIds || [])
    const candidates = routeStrategies
        .filter(strategy => strategy.enabled && (strategy.gatewayId === gateway.id || strategy.gatewayId === 0))
        .sort((left, right) => {
            if (left.flagNo !== right.flagNo) return left.flagNo - right.flagNo
            const leftScope = left.gatewayId === gateway.id ? 0 : 1
            const rightScope = right.gatewayId === gateway.id ? 0 : 1
            return leftScope - rightScope || left.id - right.id
        })
    const byFlag = new Map<number, ProxyGatewayRouteStrategy>()
    for (const strategy of candidates) {
        if (!byFlag.has(strategy.flagNo)) byFlag.set(strategy.flagNo, strategy)
    }
    return Array.from(byFlag.values())
        .filter(strategy => account.allowAllRouteStrategies || allowedIds.has(strategy.id))
        .sort((left, right) => left.flagNo - right.flagNo)
}

function createRandomExportSeed() {
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
        const values = new Uint32Array(1)
        globalThis.crypto.getRandomValues(values)
        return values[0] || 1
    }
    return Math.floor(Math.random() * 0xffffffff) || 1
}

function createRandomExportNumbers(quantity: number, seed: number) {
    const values: number[] = []
    const used = new Set<number>()
    const upperBound = Math.max(999999, quantity * 100)
    let state = seed >>> 0 || 1
    while (values.length < quantity) {
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        const value = (state >>> 0) % upperBound + 1
        if (used.has(value)) continue
        used.add(value)
        values.push(value)
    }
    return values
}

function shuffleExportValues<T>(values: T[], seed: number) {
    const shuffled = [...values]
    let state = seed >>> 0 || 1
    const random = () => {
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        return (state >>> 0) / 0x100000000
    }
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1))
        const current = shuffled[index]
        shuffled[index] = shuffled[swapIndex]
        shuffled[swapIndex] = current
    }
    return shuffled
}

function csvCell(value: string | number) {
    const text = String(value)
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function formatSmartRouteProxyExport({ account, gateway, protocol, separator, routingNumber, format }: {
    account: ProxyGatewayAccount
    gateway: ProxyGatewayListener
    protocol: ProxyExportProtocol
    separator: string
    routingNumber: number
    format: ProxyExportFormat
}) {
    const username = `${account.username}${separator}${routingNumber}`
    const password = account.password || ''
    const host = gatewayExternalHost(gateway)
    const port = gatewayExternalPort(gateway)
    const hostPort = gatewayHostPort(gateway)
    if (format === 'csv') {
        return [protocol, host, port, username, password].map(csvCell).join(',')
    }
    if (format === 'tsv') {
        return [protocol, host, port, username, password].join('\t')
    }
    if (format === 'jsonl') {
        return JSON.stringify({ protocol, host, port, username, password })
    }
    if (format === 'auth-at-host') return `${username}:${password}@${hostPort}`
    if (format === 'host-port-auth') return `${hostPort}:${username}:${password}`
    if (format === 'host-port-at-auth') return `${hostPort}@${username}:${password}`
    if (format === 'auth-host-port') return `${username}:${password}:${hostPort}`
    return `${protocol}://${urlCredential(username)}:${urlCredential(password)}@${hostPort}`
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

function urlCredential(value: string) {
    return encodeURIComponent(value)
}

async function writeClipboardText(value: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value)
            return
        } catch {
            // Fall through for non-secure origins or denied clipboard access.
        }
    }
    if (typeof document === 'undefined') throw new Error('当前环境不支持剪贴板')
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    try {
        textarea.select()
        if (!document.execCommand('copy')) throw new Error('浏览器拒绝复制')
    } finally {
        textarea.remove()
    }
}

function jsonString(value: string) {
    return JSON.stringify(value)
}

function gatewayHostPort(gateway: ProxyGatewayListener) {
    const host = gatewayExternalHost(gateway)
    if (/^\[[^\]]+\]:\d+$/.test(host) || /^[^:]+:\d+$/.test(host)) return host
    if (host.includes(':')) return `[${host.replace(/^\[|\]$/g, '')}]:${gatewayExternalPort(gateway)}`
    return `${host}:${gatewayExternalPort(gateway)}`
}

function gatewayProxyServer(gateway: ProxyGatewayListener, scheme: 'http' | 'socks5') {
    return `${scheme}://${gatewayHostPort(gateway)}`
}

function gatewayProxyUrl(account: ProxyGatewayAccount, gateway: ProxyGatewayListener, scheme: 'http' | 'socks5') {
    const hostPort = gatewayHostPort(gateway)
    if (gateway.requireAuth === false) return `${scheme}://${hostPort}`
    return `${scheme}://${urlCredential(account.username)}:${urlCredential(account.password || '')}@${hostPort}`
}

function buildGatewayProxyUrlExamples(account: ProxyGatewayAccount, gateway: ProxyGatewayListener) {
    const examples: Array<{ label: string; description: string; value: string }> = []
    if (gateway.protocol === 'http' || gateway.protocol === 'mixed') {
        examples.push({
            label: 'HTTP 代理 URL',
            description: 'http://用户名:密码@ip:端口',
            value: gatewayProxyUrl(account, gateway, 'http'),
        })
    }
    if (gateway.protocol === 'socks5' || gateway.protocol === 'mixed') {
        examples.push({
            label: 'SOCKS5 代理 URL',
            description: 'socks5://用户名:密码@ip:端口',
            value: gatewayProxyUrl(account, gateway, 'socks5'),
        })
    }
    return examples
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

function buildGatewayCodeSnippets(account: ProxyGatewayAccount, gateway: ProxyGatewayListener) {
    const httpUrl = gateway.protocol === 'http' || gateway.protocol === 'mixed' ? gatewayProxyUrl(account, gateway, 'http') : ''
    const socks5Url = gateway.protocol === 'socks5' || gateway.protocol === 'mixed' ? gatewayProxyUrl(account, gateway, 'socks5') : ''
    const preferredScheme: 'http' | 'socks5' = httpUrl ? 'http' : 'socks5'
    const preferredUrl = httpUrl || socks5Url
    const snippets: Array<{ label: string; description: string; command: string }> = []
    if (preferredUrl) {
        const envLines = httpUrl
            ? `HTTP_PROXY=${shellQuote(httpUrl)}\nHTTPS_PROXY=${shellQuote(httpUrl)}`
            : `ALL_PROXY=${shellQuote(socks5Url)}`
        snippets.push({
            label: '环境变量',
            description: httpUrl ? 'HTTP_PROXY / HTTPS_PROXY' : 'ALL_PROXY',
            command: envLines,
        })
        snippets.push({
            label: 'Python requests',
            description: 'proxies 字典示例',
            command: `import requests\n\nproxy = ${jsonString(preferredUrl)}\nproxies = { "http": proxy, "https": proxy }\nprint(requests.get("https://api.ipify.org?format=json", proxies=proxies, timeout=20).text)`,
        })
        snippets.push({
            label: 'Playwright',
            description: `${preferredScheme.toUpperCase()} 代理配置`,
            command: buildPlaywrightProxySnippet(account, gateway, preferredScheme),
        })
    }
    return snippets
}

function buildPlaywrightProxySnippet(account: ProxyGatewayAccount, gateway: ProxyGatewayListener, scheme: 'http' | 'socks5') {
    const authLines = gateway.requireAuth === false ? '' : `,\n    username: ${jsonString(account.username)},\n    password: ${jsonString(account.password || '')}`
    return `import { chromium } from 'playwright'\n\nconst browser = await chromium.launch({\n  proxy: {\n    server: ${jsonString(gatewayProxyServer(gateway, scheme))}${authLines},\n  },\n})`
}

function TargetRoutesView({ routes, strategies, onCreate, onEdit, onDelete }: {
    routes: ProxyGatewayTargetRoute[]
    strategies: ProxyGatewayRouteStrategy[]
    onCreate: () => void
    onEdit: (item: ProxyGatewayTargetRoute) => void
    onDelete: (item: ProxyGatewayTargetRoute) => void
}) {
    const strategyById = new Map(strategies.map(item => [item.id, item]))
    const hasDefault = routes.some(item => item.isDefault && item.enabled)
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-gray-500 dark:text-gray-400">按顺序匹配目标，首条命中后使用对应出口策略。</div>
                <CreateButton onClick={onCreate} label="新增目标路由" />
            </div>
            {!!routes.length && !hasDefault && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                    尚未配置启用的默认出口；未命中规则时会沿用网关用户的代理策略。
                </div>
            )}
            {!routes.length ? <EmptyState label="当前网关还没有目标路由，所有请求沿用网关用户的代理策略" /> : (
                <>
                    <div className="space-y-3 md:hidden">
                        {routes.map(item => {
                            const strategy = item.routeStrategy || strategyById.get(item.routeStrategyId)
                            const fallbackStrategy = item.fallbackRouteStrategy || (item.fallbackRouteStrategyId ? strategyById.get(item.fallbackRouteStrategyId) : undefined)
                            const strategyUnavailable = !strategy || (item.failoverEnabled && !fallbackStrategy) || strategy.enabled === false || fallbackStrategy?.enabled === false
                            return (
                                <div key={item.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-medium text-gray-900 dark:text-white">{item.name}</span>
                                                <Badge tone={item.enabled ? (strategyUnavailable ? 'amber' : 'green') : 'gray'}>
													{!item.enabled ? '已停用' : strategyUnavailable ? '关联策略不可用' : '已启用'}
                                                </Badge>
                                            </div>
                                            {item.description && <div className="mt-1 text-xs text-gray-500">{item.description}</div>}
                                        </div>
                                        <RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />
                                    </div>
                                    <dl className="mt-3 grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-2 text-sm">
                                        <dt className="text-gray-500">匹配顺序</dt>
                                        <dd className="font-mono text-xs text-gray-700 dark:text-gray-300">{item.isDefault ? '默认兜底' : item.sortOrder}</dd>
                                        <dt className="text-gray-500">目标</dt>
                                        <dd>
                                            {item.isDefault ? <Badge tone="amber">未命中时默认</Badge> : (
                                                <div className="flex flex-wrap gap-1">
                                                    {(item.matchers || []).map(matcher => <Badge key={matcher}>{matcher}</Badge>)}
                                                </div>
                                            )}
                                        </dd>
                                        <dt className="text-gray-500">出口策略</dt>
                                        <dd>
                                            <div className="font-medium text-gray-800 dark:text-gray-200">{strategy?.name || `#${item.routeStrategyId}`}</div>
                                            {strategy && <div className="mt-1 flex flex-wrap gap-1"><Badge>{strategy.selectionMode}</Badge><Badge>{strategy.selectionAlgorithm}</Badge><Badge tone={strategy.proxyIndexOverflowMode === 'modulo' ? 'green' : 'gray'}>索引{strategy.proxyIndexOverflowMode === 'modulo' ? '取模' : '越界拒绝'}</Badge></div>}
                                            {item.failoverEnabled && (
                                                <div className="mt-2 text-xs text-gray-500">
                                                    失败切换 → <span className="font-medium text-gray-700 dark:text-gray-300">{fallbackStrategy?.name || (item.fallbackRouteStrategyId ? `#${item.fallbackRouteStrategyId}` : '未找到')}</span>
                                                    <span className="ml-1">· {item.circuitBaseSeconds || 60}–{item.circuitMaxSeconds || 300}s</span>
                                                </div>
                                            )}
                                        </dd>
                                    </dl>
                                </div>
                            )
                        })}
                    </div>
                    <div className="hidden md:block">
                    <TableShell>
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                            <tr>
                                <th className="w-20 px-4 py-3 text-left">顺序</th>
                                <th className="px-4 py-3 text-left">规则</th>
                                <th className="px-4 py-3 text-left">目标</th>
                                <th className="px-4 py-3 text-left">出口策略</th>
                                <th className="px-4 py-3 text-left">状态</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {routes.map(item => {
                                const strategy = item.routeStrategy || strategyById.get(item.routeStrategyId)
                                const fallbackStrategy = item.fallbackRouteStrategy || (item.fallbackRouteStrategyId ? strategyById.get(item.fallbackRouteStrategyId) : undefined)
                                const strategyUnavailable = !strategy || (item.failoverEnabled && !fallbackStrategy) || strategy.enabled === false || fallbackStrategy?.enabled === false
                                return (
                                    <tr key={item.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40">
                                        <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.isDefault ? '—' : item.sortOrder}</td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-gray-900 dark:text-white">{item.name}</div>
                                            {item.description && <div className="mt-0.5 text-xs text-gray-500">{item.description}</div>}
                                        </td>
                                        <td className="px-4 py-3">
                                            {item.isDefault ? <Badge tone="amber">未命中时默认</Badge> : (
                                                <div className="flex max-w-xl flex-wrap gap-1">
                                                    {(item.matchers || []).map(matcher => <Badge key={matcher}>{matcher}</Badge>)}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-gray-800 dark:text-gray-200">{strategy?.name || `#${item.routeStrategyId}`}</div>
                                            {strategy && <div className="mt-1 flex flex-wrap gap-1"><Badge>{strategy.selectionMode}</Badge><Badge>{strategy.selectionAlgorithm}</Badge><Badge tone={strategy.proxyIndexOverflowMode === 'modulo' ? 'green' : 'gray'}>索引{strategy.proxyIndexOverflowMode === 'modulo' ? '取模' : '越界拒绝'}</Badge></div>}
                                            {item.failoverEnabled && (
                                                <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                                                    <Badge tone="amber">失败切换</Badge>
                                                    <span>→ {fallbackStrategy?.name || (item.fallbackRouteStrategyId ? `#${item.fallbackRouteStrategyId}` : '未找到')}</span>
                                                    <span>· 退避 {item.circuitBaseSeconds || 60}–{item.circuitMaxSeconds || 300}s</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
											<Badge tone={item.enabled ? (strategyUnavailable ? 'amber' : 'green') : 'gray'}>
												{!item.enabled ? '已停用' : strategyUnavailable ? '关联策略不可用' : '已启用'}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-right"><RowActions onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} /></td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    </TableShell>
                    </div>
                </>
            )}
        </div>
    )
}

function RouteStrategiesView({ strategies, accounts, onCreate, onEdit, onDelete }: {
    strategies: ProxyGatewayRouteStrategy[]
    accounts: ProxyGatewayAccount[]
    onCreate: () => void
    onEdit: (item: ProxyGatewayRouteStrategy) => void
    onDelete: (item: ProxyGatewayRouteStrategy) => void
}) {
    const strategyAccount = accounts.find(item => item.enableUsernameRouting && (item.usernameRoutingMode || 'strategy') === 'strategy')?.username
    const sampleAccount = strategyAccount || accounts.find(item => item.enableUsernameRouting)?.username || 'proxy_user'
    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <CreateButton onClick={onCreate} label="新增出口策略" />
            </div>
            {!strategies.length ? <EmptyState label="当前网关还没有出口策略" /> : (
                <TableShell>
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                            <tr>
                                <th className="px-4 py-3 text-left">策略</th>
                                <th className="px-4 py-3 text-left">标志号</th>
                                <th className="px-4 py-3 text-left">显式调用</th>
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
                                        <code className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">{sampleAccount}?route={item.flagNo}</code>
                                        <div className="mt-1 text-xs text-gray-500">
                                            {strategyAccount ? `${strategyAccount}#${item.flagNo}（兼容模式）` : '池内索引账号的 #N 不选择策略'}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1.5">
                                            <Badge>{item.selectionMode}</Badge>
                                            <Badge>{item.selectionAlgorithm}</Badge>
                                            <Badge tone={item.proxyIndexOverflowMode === 'modulo' ? 'green' : 'gray'}>索引{item.proxyIndexOverflowMode === 'modulo' ? '取模' : '越界拒绝'}</Badge>
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
                                            <Pencil className="h-4 w-4" />
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
                                            <Pencil className="h-4 w-4" />
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

function LogsView({ auditLogs, listenerId }: { auditLogs: ProxyGatewayAuditLog[]; listenerId?: number }) {
    const [logs, setLogs] = useState<ProxyGatewayAccessLog[]>([])
    const [loading, setLoading] = useState(false)
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(50)
    const [pageInput, setPageInput] = useState('1')
    const [filterDraft, setFilterDraft] = useState<GatewayLogFilters>(emptyGatewayLogFilters)
    const [filters, setFilters] = useState<GatewayLogFilters>(emptyGatewayLogFilters)
    const [refreshRevision, setRefreshRevision] = useState(0)
    const requestSequence = useRef(0)

    const loadLogs = useCallback(async () => {
        const sequence = ++requestSequence.current
        setLoading(true)
        try {
            const response = await proxyGatewayService.listLogs({
                page,
                limit,
                listenerId,
                sourceIp: filters.sourceIp || undefined,
                target: filters.target || undefined,
                targetMatch: filters.targetMatch,
                status: filters.status || undefined,
                accountId: filters.accountId || undefined,
                accountName: filters.accountName || undefined,
                startTime: filters.startTime ? new Date(filters.startTime).toISOString() : undefined,
                endTime: filters.endTime ? new Date(filters.endTime).toISOString() : undefined,
            })
            if (sequence !== requestSequence.current) return
            setLogs(asArray<ProxyGatewayAccessLog>(response.items))
            setTotal(Number(response.total || 0))
        } catch (error: any) {
            if (sequence === requestSequence.current) toast.error(error.message || '加载网关日志失败')
        } finally {
            if (sequence === requestSequence.current) setLoading(false)
        }
    }, [filters, limit, listenerId, page, refreshRevision])

    useEffect(() => {
        loadLogs()
    }, [loadLogs])

    const totalPages = Math.max(1, Math.ceil(total / limit))

    useEffect(() => {
        setPageInput(String(page))
    }, [page])

    useEffect(() => {
        if (page > totalPages) setPage(totalPages)
    }, [page, totalPages])

    const activeFilterCount = useMemo(() => (
        Number(!!filters.startTime)
        + Number(!!filters.endTime)
        + Number(!!filters.sourceIp)
        + Number(!!filters.target)
        + Number(!!filters.status)
        + Number(!!filters.accountId)
        + Number(!!filters.accountName)
    ), [filters])

    const applyFilters = () => {
        const next = {
            ...filterDraft,
            sourceIp: filterDraft.sourceIp.trim(),
            target: filterDraft.target.trim(),
            accountId: filterDraft.accountId.trim(),
            accountName: filterDraft.accountName.trim(),
        }
        if (next.accountId && (!Number.isSafeInteger(Number(next.accountId)) || Number(next.accountId) < 1)) {
            toast.error('网关用户 ID 必须是大于 0 的整数')
            return
        }
        if (next.target && next.targetMatch === 'regex') {
            try {
                new RegExp(next.target)
            } catch {
                toast.error('目标网站正则表达式无效')
                return
            }
        }
        if (next.startTime && next.endTime && new Date(next.startTime) > new Date(next.endTime)) {
            toast.error('开始时间不能晚于结束时间')
            return
        }
        setPage(1)
        setFilters(next)
        setRefreshRevision(value => value + 1)
    }

    const clearFilters = () => {
        const empty = emptyGatewayLogFilters()
        setFilterDraft(empty)
        setFilters(empty)
        setPage(1)
        setRefreshRevision(value => value + 1)
    }

    const jumpToPage = () => {
        const requested = Number(pageInput)
        if (!Number.isSafeInteger(requested)) {
            setPageInput(String(page))
            return
        }
        const nextPage = Math.min(totalPages, Math.max(1, requested))
        setPageInput(String(nextPage))
        setPage(nextPage)
    }

    const inputClassName = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:ring-primary-950/40'

    return (
        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <Panel>
                <div className="border-b border-gray-100 p-4 dark:border-gray-800">
                    <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.4fr)_150px_minmax(180px,1fr)_150px_auto]">
                        <label className="block text-sm">
                            <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">目标网站</span>
                            <input
                                aria-label="目标网站"
                                value={filterDraft.target}
                                onChange={event => setFilterDraft(current => ({ ...current, target: event.target.value }))}
                                onKeyDown={event => event.key === 'Enter' && applyFilters()}
                                placeholder={filterDraft.targetMatch === 'wildcard' ? '*.example.com 或 198.51.100.*' : '^api\\.(example|test)\\.com$'}
                                className={inputClassName}
                            />
                        </label>
                        <label className="block text-sm">
                            <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">匹配方式</span>
                            <select aria-label="目标匹配方式" value={filterDraft.targetMatch} onChange={event => setFilterDraft(current => ({ ...current, targetMatch: event.target.value as GatewayLogTargetMatch }))} className={inputClassName}>
                                <option value="wildcard">通配符</option>
                                <option value="regex">正则表达式</option>
                            </select>
                        </label>
                        <label className="block text-sm">
                            <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">来源 IP</span>
                            <input aria-label="来源 IP" value={filterDraft.sourceIp} onChange={event => setFilterDraft(current => ({ ...current, sourceIp: event.target.value }))} onKeyDown={event => event.key === 'Enter' && applyFilters()} placeholder="精确 IP" className={inputClassName} />
                        </label>
                        <label className="block text-sm">
                            <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">状态</span>
                            <select aria-label="日志状态" value={filterDraft.status} onChange={event => setFilterDraft(current => ({ ...current, status: event.target.value }))} className={inputClassName}>
                                <option value="">全部状态</option>
                                <option value="success">成功</option>
                                <option value="failed">失败</option>
                                <option value="denied">拒绝</option>
                            </select>
                        </label>
                        <div className="flex items-end gap-2">
                            <button type="button" onClick={applyFilters} disabled={loading} className="inline-flex h-[38px] items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                                查询
                            </button>
                            <button type="button" onClick={clearFilters} disabled={loading || (!activeFilterCount && !Object.values(filterDraft).some(value => value && value !== 'wildcard'))} className="h-[38px] rounded-lg border border-gray-200 px-3 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">重置</button>
                        </div>
                    </div>
                    <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50/70 dark:border-gray-800 dark:bg-gray-950/40">
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                            <SlidersHorizontal className="h-4 w-4" />
                            时间与网关用户
                            {activeFilterCount > 0 && <Badge tone="blue">已应用 {activeFilterCount} 项</Badge>}
                        </summary>
                        <div className="grid gap-3 border-t border-gray-200 p-3 sm:grid-cols-2 xl:grid-cols-4 dark:border-gray-800">
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">开始时间</span>
                                <input aria-label="日志开始时间" type="datetime-local" value={filterDraft.startTime} onChange={event => setFilterDraft(current => ({ ...current, startTime: event.target.value }))} className={inputClassName} />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">结束时间</span>
                                <input aria-label="日志结束时间" type="datetime-local" value={filterDraft.endTime} onChange={event => setFilterDraft(current => ({ ...current, endTime: event.target.value }))} className={inputClassName} />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">网关用户 ID</span>
                                <input aria-label="网关用户 ID" type="number" min={1} value={filterDraft.accountId} onChange={event => setFilterDraft(current => ({ ...current, accountId: event.target.value }))} className={inputClassName} />
                            </label>
                            <label className="block text-sm">
                                <span className="mb-1 block font-medium text-gray-700 dark:text-gray-200">网关用户名称</span>
                                <input aria-label="网关用户名称" value={filterDraft.accountName} onChange={event => setFilterDraft(current => ({ ...current, accountName: event.target.value }))} onKeyDown={event => event.key === 'Enter' && applyFilters()} placeholder="显示名称或登录名" className={inputClassName} />
                            </label>
                        </div>
                    </details>
                </div>
                <TableShell>
                    <table className="min-w-[920px] divide-y divide-gray-200 text-sm dark:divide-gray-800">
                        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900/60">
                            <tr>
                                <th className="px-4 py-3 text-left">时间</th>
                                <th className="px-4 py-3 text-left">账号</th>
                                <th className="px-4 py-3 text-left">目标</th>
                                <th className="px-4 py-3 text-left">上游</th>
                                <th className="px-4 py-3 text-left">流量</th>
                                <th className="px-4 py-3 text-left">状态</th>
                                <th className="px-4 py-3 text-left">耗时</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {logs.map(item => (
                                <tr key={item.id}>
                                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatTime(item.createdAt)}</td>
                                    <td className="min-w-64 px-4 py-3">
                                        <div>{item.username || '-'}</div>
                                        {(item.requestedUsername || item.clientIp || item.routeStrategyFlagNo || item.proxyIndex || item.targetRouteId || item.routeFailoverUsed) && (
                                            <div className="mt-1 flex flex-wrap gap-1 text-xs text-gray-500">
                                                {item.requestedUsername && <span>{item.requestedUsername}</span>}
                                                {item.clientIp && (
                                                    <span>
                                                        来源 {item.clientIp}{item.clientPort ? `:${item.clientPort}` : ''}
                                                    </span>
                                                )}
                                                {item.accountId ? <Badge>用户 ID {item.accountId}</Badge> : null}
                                                {item.routeStrategyFlagNo ? <Badge tone="blue">#{item.routeStrategyFlagNo}</Badge> : null}
                                                {item.proxyIndex ? (
                                                    <Badge tone="green">
                                                        池内 #{item.proxyIndex}
                                                        {item.resolvedProxyIndex && item.resolvedProxyIndex !== item.proxyIndex ? ` → #${item.resolvedProxyIndex}` : ''}
                                                        {item.proxyPoolSize ? ` / ${item.proxyPoolSize}` : ''}
                                                    </Badge>
                                                ) : null}
                                                {item.targetRouteId ? <Badge tone="amber">目标路由 #{item.targetRouteId}{item.targetRouteDefault ? ' 默认' : item.targetRouteMatcher ? ` · ${item.targetRouteMatcher}` : ''}</Badge> : null}
                                                {item.routeFailoverUsed ? <Badge tone="amber">失败切换 → 策略 #{item.fallbackRouteStrategyId || item.routeStrategyId}</Badge> : null}
                                                {item.routeCircuitState && item.routeCircuitState !== 'closed' ? <Badge tone="blue">熔断 {item.routeCircuitState}</Badge> : null}
                                                {item.routeCircuitCacheHit ? <Badge tone="blue">熔断缓存命中</Badge> : null}
                                                {item.routeCircuitProbe ? <Badge tone="blue">半开探测</Badge> : null}
                                            </div>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3">
                                        <div>{item.targetHost ? `${item.targetHost}:${item.targetPort || ''}` : '-'}</div>
                                        {isLikelyDNSFakeIPHost(item.targetHost) && <div className="mt-1"><Badge tone="amber">疑似 Fake-IP</Badge></div>}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3">{item.upstreamProxyId ? `#${item.upstreamProxyId}` : '直连/无'}</td>
                                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                                        <div>入 {formatBytes(item.bytesIn || 0)}</div>
                                        <div>出 {formatBytes(item.bytesOut || 0)}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge tone={item.status === 'success' ? 'green' : item.status === 'denied' ? 'red' : 'amber'}>{item.status}</Badge>
                                        {(item.denyReason || item.error || item.routeFailoverReason) && (
                                            <div className="mt-1 max-w-56 truncate text-xs text-gray-500" title={item.denyReason || item.error || item.routeFailoverReason}>
                                                {item.denyReason || item.error || `主策略失败：${item.routeFailoverReason}`}
                                            </div>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3">{item.durationMs}ms</td>
                                </tr>
                            ))}
                            {loading && !logs.length && (
                                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />正在加载日志</td></tr>
                            )}
                        </tbody>
                    </table>
                </TableShell>
                {!loading && !logs.length && <EmptyState label="没有符合条件的访问日志" />}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-sm dark:border-gray-800">
                    <div className="flex flex-wrap items-center gap-3 text-gray-500">
                        <span>共 {total} 条 · 第 {page} / {totalPages} 页</span>
                        <label className="inline-flex items-center gap-2">
                            每页
                            <select aria-label="日志每页数量" value={limit} onChange={event => { setLimit(Number(event.target.value)); setPage(1) }} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-gray-900 outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                                {[20, 50, 100, 200, 500].map(value => <option key={value} value={value}>{value}</option>)}
                            </select>
                            条
                        </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button aria-label="日志第一页" disabled={page <= 1 || loading} onClick={() => setPage(1)} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"><ChevronsLeft className="h-4 w-4" /></button>
                        <button disabled={page <= 1 || loading} onClick={() => setPage(value => Math.max(1, value - 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800">上一页</button>
                        <label className="inline-flex items-center gap-2 text-gray-500">
                            跳至
                            <input aria-label="日志跳转页码" type="number" min={1} max={totalPages} value={pageInput} onChange={event => setPageInput(event.target.value)} onBlur={jumpToPage} onKeyDown={event => event.key === 'Enter' && jumpToPage()} className="w-20 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-center text-gray-900 outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                        </label>
                        <button disabled={page >= totalPages || loading} onClick={() => setPage(value => Math.min(totalPages, value + 1))} className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800">下一页</button>
                        <button aria-label="日志最后一页" disabled={page >= totalPages || loading} onClick={() => setPage(totalPages)} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"><ChevronsRight className="h-4 w-4" /></button>
                    </div>
                </div>
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
            <button type="button" onClick={onEdit} className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white" title="编辑" aria-label="编辑">
                <Pencil className="h-4 w-4" />
            </button>
            <button type="button" onClick={onDelete} className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:hover:bg-rose-950/30" title="删除" aria-label="删除">
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
                        <TextField label="外部访问 IP/域名" help="不参与监听和校验，只用于列表展示和生成代理接入代码示例。" value={draft.externalHost || ''} onChange={value => setDraft({ ...draft, externalHost: value })} />
                        <OptionalNumberField label="外部访问端口" help="可选。Docker 或负载均衡把外部端口映射到监听端口时填写；留空则使用监听端口。" value={draft.externalPort} onChange={value => setDraft({ ...draft, externalPort: value })} />
                        <NumberField label="端口" help="该端口会提供 HTTP、SOCKS5 或混合代理入口。" value={draft.port || 0} onChange={value => setDraft({ ...draft, port: value })} />
                        <SelectField label="协议" help="Mixed 会自动识别 HTTP 代理请求和 SOCKS5 握手。" value={draft.protocol || 'mixed'} onChange={value => setDraft({ ...draft, protocol: value as any })} options={[['mixed', 'Mixed'], ['http', 'HTTP'], ['socks5', 'SOCKS5']]} />
                        <SearchSelect label="默认安全策略" help="网关未被路由策略覆盖时使用的访问边界。" items={securityOptions} value={draft.securityPolicyId} onChange={value => setDraft({ ...draft, securityPolicyId: value })} noneLabel="自动默认" placeholder="搜索安全策略" />
                        <SearchSelect label="默认 DNS 策略" help="网关未被路由策略覆盖时使用的 DNS 解析行为。" items={dnsOptions} value={draft.dnsPolicyId} onChange={value => setDraft({ ...draft, dnsPolicyId: value })} noneLabel="自动默认" placeholder="搜索 DNS 策略" />
                        <div className="md:col-span-2">
                            <ListField
                                label="智能用户名分隔符"
                                help="每行一个，仅允许不含冒号的符号，最多 8 个。留空时兼容使用 #；?route、?router、?rs、?strategy 查询语法始终可用。"
                                value={draft.usernameRouteSeparators?.length ? draft.usernameRouteSeparators : ['#']}
                                onChange={value => setDraft({ ...draft, usernameRouteSeparators: value })}
                            />
                        </div>
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

    const proxySelectionSource = draft?.proxySelectionSource || (draft?.id ? 'account' : 'gateway')

    useEffect(() => {
        if (proxySelectionSource === 'gateway' && (step === 'proxy' || step === 'fallback')) {
            setStep('source')
        }
    }, [proxySelectionSource, step])

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
        { id: 'routing', label: '用户名路由', description: '配置池内索引或兼容策略编号' },
        { id: 'source', label: '出口来源', description: '遵循网关或保留独立策略' },
        ...(proxySelectionSource === 'account' ? [
            { id: 'proxy' as AccountStep, label: '独立代理池', description: '兼容模式的范围和调度' },
            { id: 'fallback' as AccountStep, label: '独立 Fallback', description: '兼容模式的失败处理' },
        ] : []),
        { id: 'limits', label: '使用限制', description: '并发、速率和会话边界' },
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
                    <ModalDescription>配置认证和网关授权，并明确出口由网关还是兼容的用户独立策略决定。</ModalDescription>
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
                                <SectionTitle label="智能用户名" />
                                <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                                    <div className="grid gap-3 md:grid-cols-2">
                                        <Toggle label="允许智能用户名后缀" help="开启后可以在基础用户名后追加网关支持的分隔符和正整数。" checked={!!draft.enableUsernameRouting} onChange={value => setDraft({ ...draft, enableUsernameRouting: value })} />
                                        {draft.enableUsernameRouting && (
                                            <SelectField
                                                label="后缀含义"
                                                help="池内代理索引会在目标路由选定代理池后定位其中一个代理；策略编号保留旧版行为。"
                                                value={draft.usernameRoutingMode || 'strategy'}
                                                onChange={value => setDraft({ ...draft, usernameRoutingMode: value as any })}
                                                options={[["proxy_index", "池内代理索引"], ["strategy", "策略编号（兼容模式）"]]}
                                            />
                                        )}
                                    </div>
                                    {draft.enableUsernameRouting && (draft.usernameRoutingMode || 'strategy') === 'proxy_index' && (
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <SelectField
                                                label="账号代理池索引越界"
                                                help="仅在使用账号自有代理池时生效；目标路由选中的出口策略使用该策略自己的越界配置。"
                                                value={draft.proxyIndexOverflowMode || 'reject'}
                                                onChange={value => setDraft({ ...draft, proxyIndexOverflowMode: value as any })}
                                                options={[["reject", "拒绝连接"], ["modulo", "取模循环"]]}
                                            />
                                            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950/50 dark:text-gray-300">
                                                目标路由先选择出口策略，再用后缀索引定位该池内代理；未携带后缀时仍使用策略原有调度算法。
                                            </div>
                                        </div>
                                    )}
                                    {draft.enableUsernameRouting && (draft.usernameRoutingMode || 'strategy') === 'strategy' && (
                                        <>
                                            <Toggle label="允许全部路由策略" help="开启后该用户可使用其授权网关下的所有用户名路由策略。" checked={!!draft.allowAllRouteStrategies} onChange={value => setDraft({ ...draft, allowAllRouteStrategies: value })} />
                                            {!draft.allowAllRouteStrategies && (
                                                <SearchMultiSelect
                                                    label="允许使用的路由策略"
                                                    help="只列出当前用户可用网关下的策略，标志号会展示给用户用于拼接用户名。"
                                                    items={routeOptions}
                                                    selected={draft.allowedRouteStrategyIds || []}
                                                    onChange={value => setDraft({ ...draft, allowedRouteStrategyIds: value })}
                                                    placeholder="搜索标志号或策略名称"
                                                />
                                            )}
                                        </>
                                    )}
                                    {draft.enableUsernameRouting && (
                                        <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-950/60 dark:text-gray-300">
                                            {(draft.usernameRoutingMode || 'strategy') === 'proxy_index' ? (
                                                <>示例：<code>{draft.username || 'proxy_user'}#2</code> / <code>{draft.username || 'proxy_user'}?index=2</code></>
                                            ) : (
                                                <>兼容示例：<code>{draft.username || 'proxy_user'}#策略编号</code> / <code>{draft.username || 'proxy_user'}?route=策略编号</code></>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}

                        {step === 'source' && <ProxySelectionSourceFields draft={draft} setDraft={setDraft} />}
                        {step === 'proxy' && <ProxyStrategyFields draft={draft} setDraft={setDraft} proxyGroups={proxyGroups} proxyTags={proxyTags} proxies={proxies} section="selection" />}
                        {step === 'fallback' && <ProxyStrategyFields draft={draft} setDraft={setDraft} proxyGroups={proxyGroups} proxyTags={proxyTags} proxies={proxies} section="fallback" />}
                        {step === 'limits' && <AccountLimitsFields draft={draft} setDraft={setDraft} />}
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

function ProxySelectionSourceFields({ draft, setDraft }: {
    draft: AccountDraft
    setDraft: (draft: AccountDraft | null) => void
}) {
    const source = draft.proxySelectionSource || (draft.id ? 'account' : 'gateway')
    const options = [
        {
            id: 'gateway' as const,
            label: '遵循网关配置',
            description: '由目标路由、默认出口或已授权的用户名路由策略决定代理池。',
        },
        {
            id: 'account' as const,
            label: '独立代理策略',
            description: '保留账号自己的代理池、调度和 Fallback，适用于现有接入。',
        },
    ]
    return (
        <>
            <SectionTitle label="代理策略来源" />
            <fieldset>
                <legend className="sr-only">代理策略来源</legend>
                <div className="grid gap-3 md:grid-cols-2">
                    {options.map(option => {
                        const selected = source === option.id
                        return (
                            <button
                                key={option.id}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => setDraft({ ...draft, proxySelectionSource: option.id })}
                                className={cn(
                                    'rounded-lg border px-4 py-3 text-left transition focus:outline-none focus:ring-4 focus:ring-primary-100 dark:focus:ring-primary-950/40',
                                    selected
                                        ? 'border-primary-500 bg-primary-50/70 dark:border-primary-500 dark:bg-primary-950/20'
                                        : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600',
                                )}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-medium text-gray-900 dark:text-white">{option.label}</span>
                                    {option.id === 'gateway' && !draft.id ? <Badge tone="green">新用户默认</Badge> : null}
                                    {option.id === 'account' && draft.id ? <Badge tone="amber">兼容</Badge> : null}
                                </div>
                                <div className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{option.description}</div>
                            </button>
                        )
                    })}
                </div>
            </fieldset>
            {source === 'gateway' ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                    用户级代理池配置会被保留但不参与选路。请求未命中目标路由时，网关必须提供默认出口，或由用户显式调用已授权的用户名路由策略。
                </div>
            ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                    当前模式保持原有行为：网关目标路由优先；未决定出口时，继续使用该用户自己的代理池和 Fallback。切换到遵循网关不会删除下面的兼容配置。
                </div>
            )}
        </>
    )
}

function AccountLimitsFields({ draft, setDraft }: {
    draft: AccountDraft
    setDraft: (draft: AccountDraft | null) => void
}) {
    return (
        <>
            <SectionTitle label="限速与会话边界" />
            <div className="grid gap-3 md:grid-cols-3">
                <NumberField label="最大并发" help="该用户同时连接数上限，0 表示不限。" value={draft.maxConcurrent || 0} onChange={value => setDraft({ ...draft, maxConcurrent: value })} />
                <NumberField label="每分钟连接" help="连接速率限制，0 表示不限。" value={draft.rateLimitPerMinute || 0} onChange={value => setDraft({ ...draft, rateLimitPerMinute: value })} />
                <NumberField label="带宽 Kbps" help="带宽限制，0 表示不限。" value={draft.bandwidthLimitKbps || 0} onChange={value => setDraft({ ...draft, bandwidthLimitKbps: value })} />
                <NumberField label="连接超时秒" help="连接上游代理或目标地址的超时时间。" value={draft.connectTimeoutSeconds || 30} onChange={value => setDraft({ ...draft, connectTimeoutSeconds: value })} />
                <NumberField label="空闲超时秒" help="会话无流量达到该时间后关闭。" value={draft.idleTimeoutSeconds || 120} onChange={value => setDraft({ ...draft, idleTimeoutSeconds: value })} />
                <NumberField label="最大会话秒" help="单个会话最长存活时间，0 表示不限。" value={draft.maxSessionSeconds || 0} onChange={value => setDraft({ ...draft, maxSessionSeconds: value })} />
            </div>
        </>
    )
}

function ProxyStrategyFields({ draft, setDraft, proxyGroups, proxyTags, proxies, section = 'selection' }: {
    draft: AccountDraft | Partial<ProxyGatewayRouteStrategy>
    setDraft: (draft: any) => void
    proxyGroups: ProxyGroup[]
    proxyTags: ProxyTag[]
    proxies: ProxyPoolItem[]
    section?: StrategySection
}) {
    const groupOptions = toSearchOptions(proxyGroups, item => item.description)
    const tagOptions = toSearchOptions(proxyTags)
    const selectionMode = draft.selectionMode || 'filtered'
    const fallbackMode = draft.fallbackMode || 'interrupt'
    const isRouteStrategy = 'gatewayId' in draft || 'flagNo' in draft

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
            </>
        )
    }

    return (
        <>
            <SectionTitle label="代理选择策略" />
            <div className={cn('grid gap-3 md:grid-cols-2', isRouteStrategy ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
                <SelectField label="选择范围" help="全部可用会从所有可用代理中选择；按组/标签会根据下面条件筛选；临时代理池只使用勾选 ID。" value={draft.selectionMode || 'filtered'} onChange={value => setDraft({ ...draft, selectionMode: value as any })} options={[['all', '全部可用'], ['filtered', '按组/标签'], ['explicit', '临时代理池']]} />
                <SelectField label="调度算法" help="轮询适合均匀分摊；随机适合简单分散；优先复用会倾向最近成功的代理。" value={draft.selectionAlgorithm || 'random'} onChange={value => setDraft({ ...draft, selectionAlgorithm: value as any })} options={[['random', '随机'], ['round_robin', '轮询'], ['weighted', '权重随机'], ['lowest_latency', '最低延迟'], ['prefer_last_success', '优先复用']]} />
                {isRouteStrategy && (
                    <SelectField
                        label="索引越界"
                        help="池内索引超过代理数量时拒绝连接，或按 (N-1) % 池大小循环映射。"
                        value={draft.proxyIndexOverflowMode || 'reject'}
                        onChange={value => setDraft({ ...draft, proxyIndexOverflowMode: value as any })}
                        options={[['reject', '拒绝连接'], ['modulo', '取模循环']]}
                    />
                )}
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

function TargetRouteModal({ draft, setDraft, routeStrategies, onSave }: {
    draft: Partial<ProxyGatewayTargetRoute> | null
    setDraft: (draft: Partial<ProxyGatewayTargetRoute> | null) => void
    routeStrategies: ProxyGatewayRouteStrategy[]
    onSave: () => void
}) {
    if (!draft) return null
    const strategyOptions = toSearchOptions(routeStrategies, item => `${item.selectionMode} · ${item.selectionAlgorithm}${item.enabled ? '' : ' · 已停用'}`)
    const fallbackStrategyOptions = toSearchOptions(routeStrategies.filter(item => item.id !== draft.routeStrategyId), item => `${item.selectionMode} · ${item.selectionAlgorithm}${item.enabled ? '' : ' · 已停用'}`)
    return (
        <Modal open={!!draft} onOpenChange={open => !open && setDraft(null)}>
            <ModalContent size="6xl">
                <ModalHeader>
                    <ModalTitle>{draft.id ? '编辑目标路由' : '新增目标路由'}</ModalTitle>
                    <ModalDescription>域名、IP 和 CIDR 使用同一张有序规则表；第一条匹配规则决定出口。</ModalDescription>
                </ModalHeader>
                <ModalBody className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-2">
                        <TextField label="规则名称" help="用于规则列表和访问日志识别。" value={draft.name || ''} onChange={value => setDraft({ ...draft, name: value })} />
                        <NumberField label="匹配顺序" help="数值越小越先匹配；默认规则不参与顺序。" value={draft.sortOrder ?? 100} onChange={value => setDraft({ ...draft, sortOrder: value })} />
                        <SearchSelect label="出口策略" help="命中后先使用该策略；策略自身的重试和备用池会先执行。" items={strategyOptions} value={draft.routeStrategyId} onChange={value => setDraft({ ...draft, routeStrategyId: value, fallbackRouteStrategyId: value === draft.fallbackRouteStrategyId ? undefined : draft.fallbackRouteStrategyId })} noneLabel="请选择出口策略" placeholder="搜索出口策略" />
                        <div className="grid gap-2 sm:grid-cols-2">
                            <Toggle label="启用规则" help="停用后不参与匹配。" checked={draft.enabled !== false} onChange={value => setDraft({ ...draft, enabled: value })} />
                            <Toggle label="设为默认出口" help="仅在没有其他规则命中时使用；同一网关只保留一个默认出口。" checked={!!draft.isDefault} onChange={value => setDraft({ ...draft, isDefault: value, matchers: value ? [] : draft.matchers })} />
                        </div>
                    </div>
                    {!draft.isDefault && (
                        <ListField
                            label="目标匹配项"
                            help="每行一个：example.com、*.example.com、203.0.113.7、203.0.113.0/24 或 IPv6/CIDR。通配域名不包含根域名。"
                            value={draft.matchers || []}
                            onChange={value => setDraft({ ...draft, matchers: value })}
                        />
                    )}
                    {draft.isDefault && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                            默认出口没有匹配项，只在所有有序规则都未命中时使用。
                        </div>
                    )}
                    <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-medium text-gray-900 dark:text-white">失败切换</div>
                                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">主出口完成内部重试后仍无法连接，才切换到另一个出口策略。主出口恢复后会自动探测并切回。</p>
                            </div>
                            <Toggle label="启用" help="现有路由默认关闭；开启后必须选择不同的兜底出口。" checked={!!draft.failoverEnabled} onChange={value => setDraft({ ...draft, failoverEnabled: value })} />
                        </div>
                        {draft.failoverEnabled && (
                            <div className="mt-4 space-y-4 border-t border-gray-100 pt-4 dark:border-gray-800">
                                <SearchSelect
                                    label="兜底出口策略"
                                    help="保留智能用户名中的池索引；兜底策略独立执行自己的越界处理、DNS 和内部 Fallback。"
                                    items={fallbackStrategyOptions}
                                    value={draft.fallbackRouteStrategyId}
                                    onChange={value => setDraft({ ...draft, fallbackRouteStrategyId: value })}
                                    noneLabel="请选择不同的出口策略"
                                    placeholder="搜索兜底出口策略"
                                />
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <NumberField label="失败阈值" help="在统计窗口内，主出口失败且兜底成功达到此次数后开启熔断。" min={1} max={100} value={draft.failureThreshold || 2} onChange={value => setDraft({ ...draft, failureThreshold: value })} />
                                    <NumberField label="初始退避（秒）" help="熔断后跳过主出口的初始时长。" min={1} max={86400} value={draft.circuitBaseSeconds || 60} onChange={value => setDraft({ ...draft, circuitBaseSeconds: value })} />
                                    <NumberField label="最大退避（秒）" help="指数退避的硬上限；达到后仍按该间隔进行半开探测。" min={1} max={604800} value={draft.circuitMaxSeconds || 300} onChange={value => setDraft({ ...draft, circuitMaxSeconds: value })} />
                                </div>
                                <details className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
                                    <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-200">高级熔断参数</summary>
                                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                                        <NumberField label="统计窗口（秒）" help="只累计窗口内由兜底成功确认的主出口失败。" min={1} max={86400} value={draft.failureWindowSeconds || 30} onChange={value => setDraft({ ...draft, failureWindowSeconds: value })} />
                                        <NumberField label="退避倍数" help="半开探测失败且兜底成功时，按此倍数延长并受最大值限制。" min={1} max={10} value={draft.circuitBackoffMultiplier || 2} onChange={value => setDraft({ ...draft, circuitBackoffMultiplier: value })} />
                                        <NumberField label="抖动比例（%）" help="在退避时间上加入随机偏移，避免大量连接同时探测。" min={0} max={50} value={draft.circuitJitterPercent ?? 10} onChange={value => setDraft({ ...draft, circuitJitterPercent: value })} />
                                        <NumberField label="半开探测数" help="每个目标同时允许尝试主出口的连接数；其余连接继续走兜底。" min={1} max={10} value={draft.circuitHalfOpenProbes || 1} onChange={value => setDraft({ ...draft, circuitHalfOpenProbes: value })} />
                                    </div>
                                </details>
                                <div className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                                    只有“主出口失败且兜底成功”才累计失败或提高退避级别；两个出口同时失败不会无限加重熔断。
                                </div>
                            </div>
                        )}
                    </section>
                    <TextareaField label="描述" help="记录该规则适用的服务或出口要求。" value={draft.description || ''} onChange={value => setDraft({ ...draft, description: value })} />
                </ModalBody>
                <ModalFooter>
                    <button onClick={() => setDraft(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700">取消</button>
                    <button onClick={onSave} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">保存并生效</button>
                </ModalFooter>
            </ModalContent>
        </Modal>
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
                    <ModalTitle>{draft.id ? '编辑出口策略' : '新增出口策略'}</ModalTitle>
                    <ModalDescription>配置可由目标路由自动选择，也可通过 ?route=标志号显式调用的代理出口；#标志号仅用于兼容账号。</ModalDescription>
                </ModalHeader>
                <ModalBody className="grid gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
                    <WizardRail steps={steps} current={step} onChange={setStep} />
                    <div className="min-h-[500px] space-y-5">
                        {step === 'basic' && (
                            <>
                                <SectionTitle label="基础信息" />
                                <div className="grid gap-3 md:grid-cols-3">
                                    <TextField label="策略名称" help="用于账号授权和日志识别。" value={draft.name || ''} onChange={value => setDraft({ ...draft, name: value })} />
                                    <NumberField label="标志号" help="显式调用使用 username?route=标志号；只有策略编号兼容账号才使用 username#标志号。" value={draft.flagNo || 0} onChange={value => setDraft({ ...draft, flagNo: value })} />
                                    <Toggle label="启用策略" help="停用后即使账号已授权也无法使用该标志号。" checked={draft.enabled !== false} onChange={value => setDraft({ ...draft, enabled: value })} />
                                </div>
                                <TextareaField label="描述" help="记录该标志号对应业务或代理池用途。" value={draft.description || ''} onChange={value => setDraft({ ...draft, description: value })} />
                                <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-950/60 dark:text-gray-300">
                                    显式调用：<code>proxy_user?route={draft.flagNo || '标志号'}</code>；兼容模式：<code>proxy_user#{draft.flagNo || '标志号'}</code>
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

function NumberField({ label, value, onChange, help, min, max }: {
    label: string
    value: number
    onChange: (value: number) => void
    help?: string
    min?: number
    max?: number
}) {
    return (
        <label className="block text-sm">
            <FieldLabel label={label} help={help} />
            <input type="number" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-primary-950/40" />
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

function SearchSelect({ label, help, items, value, onChange, placeholder = '搜索并选择', noneLabel, emptyLabel = '暂无可选项', clearable = true }: {
    label?: string
    help?: string
    items: SearchOption[]
    value?: number
    onChange: (value?: number) => void
    placeholder?: string
    noneLabel?: string
    emptyLabel?: string
    clearable?: boolean
}) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const ref = useRef<HTMLDivElement>(null)
    const listboxId = useId()
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
                    aria-label={label || placeholder}
                    aria-controls={listboxId}
                    aria-expanded={open}
                    role="combobox"
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
                {clearable && value && (
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
                <div id={listboxId} role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900">
                    {noneLabel && (
                        <button
                            type="button"
                            role="option"
                            aria-selected={!value}
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
                            role="option"
                            aria-selected={item.id === value}
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

function isLikelyDNSFakeIPHost(host?: string) {
    if (!host) return false
    const match = host.match(/^198\.(\d{1,3})\./)
    if (!match) return false
    const secondOctet = Number(match[1])
    return secondOctet === 18 || secondOctet === 19
}
