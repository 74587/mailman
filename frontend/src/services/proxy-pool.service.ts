import { apiClient } from '@/lib/api-client'
import {
    ProxyFallbackMode,
    ProxyGroup,
    ProxyPoolItem,
    ProxyStatus,
    ProxyTag,
    ProxyTagFilterMode,
    ProxyType,
} from '@/types'

export interface ProxyPoolFilter {
    page?: number
    limit?: number
    search?: string
    status?: ProxyStatus | ''
    type?: ProxyType | ''
    groupIds?: number[]
    tagIds?: number[]
    tagMode?: ProxyTagFilterMode
    usageScope?: string
    exitIp?: string
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
}

export interface ProxyListResponse {
    items: ProxyPoolItem[]
    total: number
    page: number
    limit: number
    trafficSummary?: {
        trafficBytesIn: number
        trafficBytesOut: number
    }
}

export interface ProxyCheckChannel {
    id: number
    orgId: number
    key: string
    name: string
    provider?: string
    description?: string
    mode: 'self' | 'lookup'
    urlTemplate: string
    method: 'GET'
    responseFormat: 'json' | 'text' | 'regex'
    responseRegex?: string
    ipField?: string
    countryField?: string
    regionField?: string
    cityField?: string
    ispField?: string
    statusField?: string
    failureValue?: string
    messageField?: string
    headers?: Record<string, string>
    authType: 'none' | 'bearer' | 'query' | 'header' | 'path'
    authName?: string
    hasCredential: boolean
    enabled: boolean
    builtIn: boolean
    supportsIPv4: boolean
    supportsIPv6: boolean
    timeoutSeconds: number
    sortOrder: number
    createdAt?: string
    updatedAt?: string
}

export type ProxyCheckChannelPayload = Omit<ProxyCheckChannel, 'id' | 'orgId' | 'hasCredential' | 'builtIn' | 'createdAt' | 'updatedAt'> & {
    credential?: string
}

export interface ProxyCheckChannelTestResult {
    success: boolean
    httpStatus?: number
    latencyMs: number
    contentType?: string
    rawBody?: string
    bodyTruncated?: boolean
    exitIp?: string
    country?: string
    region?: string
    city?: string
    isp?: string
    captures?: string[]
    statusValue?: string
    failureValue?: string
    failureMatched: boolean
    messageValue?: string
    usedProxyId?: number
    decision: string
    error?: string
}

export interface ProxyCheckResult {
    proxyId: number
    success: boolean
    status: ProxyStatus
    latencyMs: number
    exitIp?: string
    country?: string
    region?: string
    city?: string
    isp?: string
    error?: string
    warning?: string
    inconclusive?: boolean
    checkChannel: string
    usedChannel?: string
}

export interface ProxyPayload {
    type: ProxyType
    host: string
    port: number
    username?: string
    password?: string
    refreshUrl?: string
    remark?: string
    groupId?: number
    tagIds?: number[]
    usageScope?: string
}

export interface BulkImportProxyPayload {
    defaultType: ProxyType
    groupId?: number
    tagIds?: number[]
    checkProxy?: boolean
    channel?: string
    duplicatePolicy?: 'allow' | 'skip' | 'update'
    content: string
}

export interface BulkDeleteProxyPayload {
    ids?: number[]
    filter?: ProxyPoolFilter
    replacement: {
        mode: 'clear' | 'proxy' | 'auto' | 'manual'
        proxyId?: number
        groupIds?: number[]
        tagIds?: number[]
        tagMode?: ProxyTagFilterMode
        fallbackProxy?: string
    }
}

class ProxyPoolService {
    private readonly basePath = '/proxy-pool'

    async list(filters: ProxyPoolFilter = {}): Promise<ProxyListResponse> {
        const params: Record<string, any> = {
            ...filters,
            groupIds: filters.groupIds?.join(','),
            tagIds: filters.tagIds?.join(','),
        }
        Object.keys(params).forEach(key => {
            if (params[key] === undefined || params[key] === '' || params[key] === null) {
                delete params[key]
            }
        })
        return apiClient.get<ProxyListResponse>(this.basePath, { params })
    }

    async get(id: number): Promise<ProxyPoolItem> {
        return apiClient.get<ProxyPoolItem>(`${this.basePath}/${id}`)
    }

    async create(payload: ProxyPayload): Promise<ProxyPoolItem> {
        return apiClient.post<ProxyPoolItem>(this.basePath, payload)
    }

    async update(id: number, payload: ProxyPayload): Promise<ProxyPoolItem> {
        return apiClient.put<ProxyPoolItem>(`${this.basePath}/${id}`, payload)
    }

    async delete(id: number): Promise<{ deleted: number; affectedAccounts: number }> {
        return apiClient.delete(`${this.basePath}/${id}`)
    }

    async bulkImport(payload: BulkImportProxyPayload): Promise<{
        created: ProxyPoolItem[]
        errors: Array<{ line: number; content: string; error: string }>
        checks?: ProxyCheckResult[]
        summary: Record<string, any>
    }> {
        return apiClient.post(`${this.basePath}/bulk-import`, payload)
    }

    async test(id: number, channel?: string): Promise<ProxyCheckResult> {
        return apiClient.post<ProxyCheckResult>(`${this.basePath}/${id}/test`, undefined, {
            params: channel ? { channel } : undefined,
        })
    }

    async batchTest(payload: { ids?: number[]; filter?: ProxyPoolFilter; channel?: string; timeoutSeconds?: number }): Promise<{ results: ProxyCheckResult[]; total: number }> {
        return apiClient.post(`${this.basePath}/test-batch`, payload)
    }

    async batchDelete(payload: BulkDeleteProxyPayload): Promise<{ deleted: number; affectedAccounts: number }> {
        return apiClient.delete(`${this.basePath}/batch`, { data: payload })
    }

    async selectAvailable(payload: { groupIds?: number[]; tagIds?: number[]; tagMode?: ProxyTagFilterMode; excludeIds?: number[] }): Promise<ProxyPoolItem> {
        return apiClient.post(`${this.basePath}/select`, payload)
    }

    async getCheckChannels(includeDisabled = false): Promise<ProxyCheckChannel[]> {
        return apiClient.get(`${this.basePath}/check-channels`, { params: includeDisabled ? { includeDisabled: true } : undefined })
    }

    async createCheckChannel(payload: ProxyCheckChannelPayload): Promise<ProxyCheckChannel> {
        return apiClient.post(`${this.basePath}/check-channels`, payload)
    }

    async updateCheckChannel(id: number, payload: ProxyCheckChannelPayload): Promise<ProxyCheckChannel> {
        return apiClient.put(`${this.basePath}/check-channels/${id}`, payload)
    }

    async deleteCheckChannel(id: number): Promise<void> {
        await apiClient.delete(`${this.basePath}/check-channels/${id}`)
    }

    async testCheckChannel(payload: {
        channelId?: number
        proxyId?: number
        lookupIp?: string
        channel: ProxyCheckChannelPayload
    }): Promise<ProxyCheckChannelTestResult> {
        return apiClient.post(`${this.basePath}/check-channels/test`, payload)
    }

    async listGroups(): Promise<ProxyGroup[]> {
        return apiClient.get('/proxy-groups')
    }

    async createGroup(payload: Partial<ProxyGroup>): Promise<ProxyGroup> {
        return apiClient.post('/proxy-groups', payload)
    }

    async updateGroup(id: number, payload: Partial<ProxyGroup>): Promise<ProxyGroup> {
        return apiClient.put(`/proxy-groups/${id}`, payload)
    }

    async deleteGroup(id: number): Promise<void> {
        await apiClient.delete(`/proxy-groups/${id}`)
    }

    async listTags(): Promise<ProxyTag[]> {
        return apiClient.get('/proxy-tags')
    }

    async createTag(payload: Partial<ProxyTag>): Promise<ProxyTag> {
        return apiClient.post('/proxy-tags', payload)
    }

    async updateTag(id: number, payload: Partial<ProxyTag>): Promise<ProxyTag> {
        return apiClient.put(`/proxy-tags/${id}`, payload)
    }

    async deleteTag(id: number): Promise<void> {
        await apiClient.delete(`/proxy-tags/${id}`)
    }
}

export const proxyPoolService = new ProxyPoolService()

export function proxyToUrl(proxy: ProxyPoolItem, includePassword = false) {
    const password = includePassword ? encodeURIComponent(proxy.password || '') : '***'
    const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${password}@` : ''
    const host = proxy.host.includes(':') && !proxy.host.startsWith('[') ? `[${proxy.host}]` : proxy.host
    return `${proxy.type}://${auth}${host}:${proxy.port}`
}

export function buildManualProxyUrl(typeOrUrl: string, hostOrUrl?: string, port?: number, username?: string, password?: string) {
    const raw = (hostOrUrl || typeOrUrl || '').trim()
    if (!raw) return ''
    if (raw.includes('://')) {
        try {
            const url = new URL(raw)
            if (username) url.username = username
            if (password) url.password = password
            return url.toString()
        } catch {
            return raw
        }
    }
    const type = (typeOrUrl || 'socks5').trim()
    if (!hostOrUrl || !port) return raw
    const host = hostOrUrl.includes(':') && !hostOrUrl.startsWith('[') ? `[${hostOrUrl}]` : hostOrUrl
    const auth = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password || '')}@` : ''
    return `${type}://${auth}${host}:${port}`
}

export type { ProxyFallbackMode }
