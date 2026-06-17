import { apiClient } from '@/lib/api-client'
import { getApiBaseUrl } from '@/lib/runtime-url'

export interface OutputLogEntry {
    id: number
    time: string
    level: string
    module: string
    message: string
    file?: string
    line?: number
    source: string
}

export interface OutputLogFilter {
    q?: string
    level?: string
    module?: string
    source?: string
    from?: string
    to?: string
    since_id?: number
    limit?: number
}

export interface OutputLogConfig {
    enabled: boolean
    bufferLimit: number
    queryLimitMax: number
    streamBackfillLimit: number
    subscriberBuffer: number
    maxSubscribers: number
}

export interface BusinessLog {
    id: number
    orgId: number
    userId?: number
    operationType: string
    actorType: string
    actorId?: string
    actorName?: string
    module: string
    action: string
    entityType?: string
    entityId?: string
    entityName?: string
    title: string
    summary?: string
    result?: string
    status: string
    startedAt: string
    finishedAt?: string
    durationMs: number
    traceId?: string
    runId?: string
    requestId?: string
    errorCode?: string
    errorMessage?: string
    details?: Record<string, any>
    sourceIp?: string
    userAgent?: string
    user?: {
        id: number
        username: string
        email: string
    }
}

export interface BusinessLogListResult {
    items: BusinessLog[]
    total: number
    limit: number
    offset: number
    beforeId?: number
    afterId?: number
    nextCursor?: number
    hasMore?: boolean
}

export interface BusinessLogStats {
    total: number
    byStatus: Array<{ key: string; count: number }>
    byModule: Array<{ key: string; count: number }>
}

export interface BusinessLogModuleConfig {
    enabled?: boolean
    detailLevel?: string
    successSampleRate?: number
    recordActions?: string[]
    ignoreActions?: string[]
    limit?: number
    redactSensitive?: boolean
    mergeEnabled?: boolean
    mergeWindowSeconds?: number
}

export interface BusinessLogScopeConfig {
    enabled?: boolean
    redactSensitive?: boolean
    detailLevel?: string
    forceRecordFailures?: boolean
    successSampleRate?: number
    retentionDays?: number
    globalLimit?: number
    moduleLimits?: Record<string, number>
    modules?: Record<string, BusinessLogModuleConfig>
    sensitiveFields?: string[]
    reviewMiddlewareMode?: string
}

export interface BusinessLogConfig {
    enabled: boolean
    redactSensitive: boolean
    detailLevel: string
    forceRecordFailures: boolean
    successSampleRate: number
    retentionDays: number
    globalLimit: number
    moduleLimits: Record<string, number>
    modules: Record<string, BusinessLogModuleConfig>
    organizationConfigs: Record<string, BusinessLogScopeConfig>
    sensitiveFields: string[]
    reviewMiddlewareMode: string
}

function paramsFromObject(params: Record<string, any>) {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return
        search.set(key, String(value))
    })
    return search.toString()
}

function authHeaders(): HeadersInit {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
    return token ? { Authorization: `Bearer ${token}` } : {}
}

export const loggingService = {
    async listOutputLogs(filter: OutputLogFilter = {}): Promise<{ items: OutputLogEntry[]; limit: number }> {
        return apiClient.get(`/output-logs?${paramsFromObject(filter)}`)
    },

    async listOutputModules(): Promise<string[]> {
        const response = await apiClient.get<{ modules: string[] }>('/output-logs/modules')
        return response.modules || []
    },

    async getOutputLogConfig(): Promise<OutputLogConfig> {
        return apiClient.get('/output-logs/config')
    },

    async updateOutputLogConfig(config: OutputLogConfig): Promise<OutputLogConfig> {
        return apiClient.put('/output-logs/config', config)
    },

    async streamOutputLogs(
        filter: OutputLogFilter,
        onLog: (entry: OutputLogEntry) => void,
        signal: AbortSignal,
    ): Promise<void> {
        const url = `${getApiBaseUrl()}/output-logs/stream?${paramsFromObject(filter)}`
        const headers: HeadersInit = {
            Accept: 'text/event-stream',
            ...authHeaders(),
        }
        const response = await fetch(url, {
            headers,
            signal,
        })
        if (!response.ok || !response.body) {
            throw new Error(`日志流连接失败: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const chunks = buffer.split('\n\n')
            buffer = chunks.pop() || ''
            chunks.forEach(chunk => {
                const dataLine = chunk.split('\n').find(line => line.startsWith('data: '))
                if (!dataLine) return
                try {
                    onLog(JSON.parse(dataLine.slice(6)))
                } catch {
                    // ignore malformed stream chunks
                }
            })
        }
    },

    async listBusinessLogs(params: Record<string, any> = {}): Promise<BusinessLogListResult> {
        return apiClient.get(`/business-logs?${paramsFromObject(params)}`)
    },

    async getBusinessLog(id: number): Promise<BusinessLog> {
        return apiClient.get(`/business-logs/${id}`)
    },

    async getBusinessLogStats(params: Record<string, any> = {}): Promise<BusinessLogStats> {
        return apiClient.get(`/business-logs/stats?${paramsFromObject(params)}`)
    },

    async getBusinessLogConfig(): Promise<BusinessLogConfig> {
        return apiClient.get('/business-logs/config')
    },

    async updateBusinessLogConfig(config: BusinessLogConfig): Promise<BusinessLogConfig> {
        return apiClient.put('/business-logs/config', config)
    },
}
