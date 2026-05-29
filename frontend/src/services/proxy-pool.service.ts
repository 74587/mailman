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
}

export interface ProxyCheckChannel {
    id: string
    name: string
    url: string
    description: string
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
    checkChannel: string
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

    async getCheckChannels(): Promise<ProxyCheckChannel[]> {
        return apiClient.get(`${this.basePath}/check-channels`)
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

export function proxyToUrl(proxy: ProxyPoolItem) {
    const auth = proxy.username ? `${proxy.username}:***@` : ''
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
