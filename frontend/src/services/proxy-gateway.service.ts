import { apiClient } from '@/lib/api-client'
import { ProxyGroup, ProxyTag, ProxyTagFilterMode } from '@/types'

export type ProxyGatewayProtocol = 'http' | 'socks5' | 'mixed'
export type ProxyGatewaySelectionMode = 'all' | 'filtered' | 'explicit'
export type ProxyGatewaySelectionAlgorithm = 'random' | 'round_robin' | 'weighted' | 'lowest_latency' | 'prefer_last_success'
export type ProxyGatewayFallbackMode = 'interrupt' | 'retry' | 'backup_pool' | 'direct'
export type ProxyGatewayStickyMode = 'none' | 'account' | 'client_ip' | 'target_host' | 'client_ip_target_host'
export type ProxyGatewayDNSMode = 'remote' | 'local' | 'custom'
export type ProxyGatewayPolicyAction = 'deny' | 'allow' | 'log_only'
export type ProxyGatewayMultiIPStrategy = 'check_all' | 'first_only' | 'reject_private'
export type ProxyGatewayResolveFailureAction = 'deny' | 'remote_fallback'

export interface ProxyGatewayListener {
    id: number
    orgId?: number
    name: string
    listenIp: string
    externalHost?: string
    externalPort?: number
    port: number
    protocol: ProxyGatewayProtocol
    enabled: boolean
    isDefault: boolean
    allowPublicListen: boolean
    requireAuth: boolean
    securityPolicyId?: number
    dnsPolicyId?: number
    handshakeTimeoutSeconds: number
    idleTimeoutSeconds: number
    connectTimeoutSeconds: number
    createdAt?: string
    updatedAt?: string
}

export interface ProxyGatewayAccountGroup {
    id: number
    name: string
    description?: string
    color?: string
    sortOrder?: number
}

export interface ProxyGatewayAccountTag {
    id: number
    name: string
    color?: string
    sortOrder?: number
}

export interface ProxyGatewayAccount {
    id: number
    username: string
    password?: string
    name?: string
    remark?: string
    enabled: boolean
    expiresAt?: string
    allowAllGateways: boolean
    allowedGatewayIds?: number[]
    groupId?: number
    group?: ProxyGatewayAccountGroup
    tags?: ProxyGatewayAccountTag[]
    selectionMode: ProxyGatewaySelectionMode
    proxyIds?: number[]
    proxyMatchGroupIds?: number[]
    proxyMatchTagIds?: number[]
    proxyMatchTagMode?: ProxyTagFilterMode
    selectionAlgorithm: ProxyGatewaySelectionAlgorithm
    stickyMode: ProxyGatewayStickyMode
    stickyTtlSeconds: number
    preferLastSuccess: boolean
    fallbackMode: ProxyGatewayFallbackMode
    fallbackProxyIds?: number[]
    fallbackGroupIds?: number[]
    fallbackTagIds?: number[]
    fallbackTagMode?: ProxyTagFilterMode
    maxRetries: number
    allowDirectFallback: boolean
    securityPolicyId?: number
    dnsPolicyId?: number
    maxConcurrent: number
    rateLimitPerMinute: number
    bandwidthLimitKbps: number
    connectTimeoutSeconds: number
    idleTimeoutSeconds: number
    maxSessionSeconds: number
    enableUsernameRouting: boolean
    allowAllRouteStrategies: boolean
    allowedRouteStrategyIds?: number[]
    lastUsedAt?: string
    createdAt?: string
    updatedAt?: string
}

export interface ProxyGatewayRouteStrategy {
    id: number
    gatewayId: number
    name: string
    flagNo: number
    description?: string
    enabled: boolean
    selectionMode: ProxyGatewaySelectionMode
    proxyIds?: number[]
    proxyMatchGroupIds?: number[]
    proxyMatchTagIds?: number[]
    proxyMatchTagMode?: ProxyTagFilterMode
    selectionAlgorithm: ProxyGatewaySelectionAlgorithm
    stickyMode: ProxyGatewayStickyMode
    stickyTtlSeconds: number
    preferLastSuccess: boolean
    fallbackMode: ProxyGatewayFallbackMode
    fallbackProxyIds?: number[]
    fallbackGroupIds?: number[]
    fallbackTagIds?: number[]
    fallbackTagMode?: ProxyTagFilterMode
    maxRetries: number
    allowDirectFallback: boolean
    securityPolicyId?: number
    dnsPolicyId?: number
    createdAt?: string
    updatedAt?: string
}

export interface ProxyGatewayTargetRoute {
    id: number
    gatewayId: number
    name: string
    description?: string
    enabled: boolean
    isDefault: boolean
    sortOrder: number
    matchers?: string[]
    routeStrategyId: number
    routeStrategy?: ProxyGatewayRouteStrategy
    createdAt?: string
    updatedAt?: string
}

export interface ProxyGatewaySecurityPolicy {
    id: number
    gatewayId: number
    name: string
    description?: string
    isDefault: boolean
    sourceAllowCidrs?: string[]
    sourceDenyCidrs?: string[]
    targetHostAllowlist?: string[]
    targetHostDenylist?: string[]
    targetPortAllowlist?: string[]
    targetPortDenylist?: string[]
    blockPrivateIp: boolean
    blockLoopback: boolean
    blockLinkLocal: boolean
    blockMulticast: boolean
    blockMetadataIp: boolean
    dnsRebindingProtection: boolean
    noMatchAction: ProxyGatewayPolicyAction
    createdAt?: string
    updatedAt?: string
}

export interface ProxyGatewayDNSPolicy {
    id: number
    gatewayId: number
    name: string
    description?: string
    isDefault: boolean
    mode: ProxyGatewayDNSMode
    resolvers?: string[]
    socks5RemoteResolve: boolean
    httpConnectPreserveHost: boolean
    preResolveForSecurity: boolean
    cacheTtlSeconds: number
    negativeTtlSeconds: number
    multiIpStrategy: ProxyGatewayMultiIPStrategy
    resolveFailureAction: ProxyGatewayResolveFailureAction
    createdAt?: string
    updatedAt?: string
}

export interface ProxyGatewayAccessLog {
    id: number
    listenerId?: number
    accountId?: number
    username?: string
    requestedUsername?: string
    clientIp?: string
    clientPort?: string
    protocol: string
    command?: string
    targetHost?: string
    targetPort?: number
    upstreamProxyId?: number
    status: string
    denyReason?: string
    error?: string
    bytesIn: number
    bytesOut: number
    durationMs: number
    dnsMode?: string
    securityPolicyId?: number
    dnsPolicyId?: number
    routeStrategyId?: number
    routeStrategyFlagNo?: number
    routeParams?: Record<string, any>
    targetRouteId?: number
    targetRouteMatcher?: string
    targetRouteDefault?: boolean
    createdAt: string
}

export interface ProxyGatewayAuditLog {
    id: number
    actorUserId?: number
    action: string
    resource: string
    resourceId?: number
    summary?: string
    createdAt: string
}

export interface ProxyGatewayStatus {
    listenerId: number
    name: string
    listenAddress: string
    protocol: string
    enabled: boolean
    running: boolean
    activeConns: number
    totalConns: number
    totalBytesIn: number
    totalBytesOut: number
    lastError?: string
    lastStartedAt?: string
    lastReloadedAt?: string
}

export interface ListResponse<T> {
    items: T[]
    total: number
    page: number
    limit: number
}

export interface ProxyGatewayValidationResult {
    valid: boolean
    available?: boolean
    strength?: string
    message?: string
}

class ProxyGatewayService {
    private readonly basePath = '/proxy-gateway'

    listListeners(): Promise<ProxyGatewayListener[]> {
        return apiClient.get(`${this.basePath}/listeners`)
    }

    createListener(payload: Partial<ProxyGatewayListener>): Promise<ProxyGatewayListener> {
        return apiClient.post(`${this.basePath}/listeners`, payload)
    }

    updateListener(id: number, payload: Partial<ProxyGatewayListener>): Promise<ProxyGatewayListener> {
        return apiClient.put(`${this.basePath}/listeners/${id}`, payload)
    }

    deleteListener(id: number): Promise<void> {
        return apiClient.delete(`${this.basePath}/listeners/${id}`)
    }

    listAccounts(params: Record<string, any> = {}): Promise<ListResponse<ProxyGatewayAccount>> {
        return apiClient.get(`${this.basePath}/accounts`, { params })
    }

    createAccount(payload: Partial<ProxyGatewayAccount> & { password?: string; tagIds?: number[] }): Promise<ProxyGatewayAccount> {
        return apiClient.post(`${this.basePath}/accounts`, payload)
    }

    updateAccount(id: number, payload: Partial<ProxyGatewayAccount> & { password?: string; tagIds?: number[] }): Promise<ProxyGatewayAccount> {
        return apiClient.put(`${this.basePath}/accounts/${id}`, payload)
    }

    deleteAccount(id: number): Promise<void> {
        return apiClient.delete(`${this.basePath}/accounts/${id}`)
    }

    async listRouteStrategies(params: Record<string, any> = {}): Promise<ProxyGatewayRouteStrategy[]> {
        const response = await apiClient.get<unknown>(`${this.basePath}/route-strategies`, { params })
        if (Array.isArray(response)) {
            return response as ProxyGatewayRouteStrategy[]
        }
        if (response && typeof response === 'object' && Array.isArray((response as { items?: unknown }).items)) {
            return (response as { items: ProxyGatewayRouteStrategy[] }).items
        }
        throw new Error('路由策略接口返回格式异常，请确认后端服务已更新并重启')
    }

    createRouteStrategy(payload: Partial<ProxyGatewayRouteStrategy>): Promise<ProxyGatewayRouteStrategy> {
        return apiClient.post(`${this.basePath}/route-strategies`, payload)
    }

    updateRouteStrategy(id: number, payload: Partial<ProxyGatewayRouteStrategy>): Promise<ProxyGatewayRouteStrategy> {
        return apiClient.put(`${this.basePath}/route-strategies/${id}`, payload)
    }

    deleteRouteStrategy(id: number): Promise<void> {
        return apiClient.delete(`${this.basePath}/route-strategies/${id}`)
    }

    listTargetRoutes(params: Record<string, any> = {}): Promise<ProxyGatewayTargetRoute[]> {
        return apiClient.get(`${this.basePath}/target-routes`, { params })
    }

    createTargetRoute(payload: Partial<ProxyGatewayTargetRoute>): Promise<ProxyGatewayTargetRoute> {
        return apiClient.post(`${this.basePath}/target-routes`, payload)
    }

    updateTargetRoute(id: number, payload: Partial<ProxyGatewayTargetRoute>): Promise<ProxyGatewayTargetRoute> {
        return apiClient.put(`${this.basePath}/target-routes/${id}`, payload)
    }

    deleteTargetRoute(id: number): Promise<void> {
        return apiClient.delete(`${this.basePath}/target-routes/${id}`)
    }

    validateAccountUsername(payload: { username: string; excludeId?: number }): Promise<ProxyGatewayValidationResult> {
        return apiClient.post(`${this.basePath}/accounts/validate-username`, payload)
    }

    validateAccountPassword(payload: { password: string }): Promise<ProxyGatewayValidationResult> {
        return apiClient.post(`${this.basePath}/accounts/validate-password`, payload)
    }

    listAccountGroups(): Promise<ProxyGatewayAccountGroup[]> {
        return apiClient.get(`${this.basePath}/account-groups`)
    }

    createAccountGroup(payload: Partial<ProxyGatewayAccountGroup>): Promise<ProxyGatewayAccountGroup> {
        return apiClient.post(`${this.basePath}/account-groups`, payload)
    }

    updateAccountGroup(id: number, payload: Partial<ProxyGatewayAccountGroup>): Promise<ProxyGatewayAccountGroup> {
        return apiClient.put(`${this.basePath}/account-groups/${id}`, payload)
    }

    deleteAccountGroup(id: number): Promise<void> {
        return apiClient.delete(`${this.basePath}/account-groups/${id}`)
    }

    listAccountTags(): Promise<ProxyGatewayAccountTag[]> {
        return apiClient.get(`${this.basePath}/account-tags`)
    }

    createAccountTag(payload: Partial<ProxyGatewayAccountTag>): Promise<ProxyGatewayAccountTag> {
        return apiClient.post(`${this.basePath}/account-tags`, payload)
    }

    updateAccountTag(id: number, payload: Partial<ProxyGatewayAccountTag>): Promise<ProxyGatewayAccountTag> {
        return apiClient.put(`${this.basePath}/account-tags/${id}`, payload)
    }

    deleteAccountTag(id: number): Promise<void> {
        return apiClient.delete(`${this.basePath}/account-tags/${id}`)
    }

    listSecurityPolicies(params: Record<string, any> = {}): Promise<ProxyGatewaySecurityPolicy[]> {
        return apiClient.get(`${this.basePath}/security-policies`, { params })
    }

    createSecurityPolicy(payload: Partial<ProxyGatewaySecurityPolicy>): Promise<ProxyGatewaySecurityPolicy> {
        return apiClient.post(`${this.basePath}/security-policies`, payload)
    }

    updateSecurityPolicy(id: number, payload: Partial<ProxyGatewaySecurityPolicy>): Promise<ProxyGatewaySecurityPolicy> {
        return apiClient.put(`${this.basePath}/security-policies/${id}`, payload)
    }

    deleteSecurityPolicy(id: number): Promise<void> {
        return apiClient.delete(`${this.basePath}/security-policies/${id}`)
    }

    listDNSPolicies(params: Record<string, any> = {}): Promise<ProxyGatewayDNSPolicy[]> {
        return apiClient.get(`${this.basePath}/dns-policies`, { params })
    }

    createDNSPolicy(payload: Partial<ProxyGatewayDNSPolicy>): Promise<ProxyGatewayDNSPolicy> {
        return apiClient.post(`${this.basePath}/dns-policies`, payload)
    }

    updateDNSPolicy(id: number, payload: Partial<ProxyGatewayDNSPolicy>): Promise<ProxyGatewayDNSPolicy> {
        return apiClient.put(`${this.basePath}/dns-policies/${id}`, payload)
    }

    deleteDNSPolicy(id: number): Promise<void> {
        return apiClient.delete(`${this.basePath}/dns-policies/${id}`)
    }

    listLogs(params: Record<string, any> = {}): Promise<ListResponse<ProxyGatewayAccessLog>> {
        return apiClient.get(`${this.basePath}/logs`, { params })
    }

    listAuditLogs(limit = 100): Promise<ProxyGatewayAuditLog[]> {
        return apiClient.get(`${this.basePath}/audit-logs`, { params: { limit } })
    }

    status(): Promise<ProxyGatewayStatus[]> {
        return apiClient.get(`${this.basePath}/status`)
    }

    reload(): Promise<{ success: boolean; status: ProxyGatewayStatus[] }> {
        return apiClient.post(`${this.basePath}/reload`)
    }
}

export const proxyGatewayService = new ProxyGatewayService()

export function toNumberList(value: string): number[] {
    return value
        .split(',')
        .map(item => Number(item.trim()))
        .filter(item => Number.isFinite(item) && item > 0)
}

export function toStringList(value: string): string[] {
    return value
        .split('\n')
        .flatMap(line => line.split(','))
        .map(item => item.trim())
        .filter(Boolean)
}

export function listToText(value?: Array<string | number>): string {
    return (value || []).join(', ')
}

export type { ProxyGroup, ProxyTag }
