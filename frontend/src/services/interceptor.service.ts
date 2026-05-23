import { apiClient } from '@/lib/api-client'

// 拦截器作用域
export type InterceptorScope = 'global' | 'local'

// 错误处理策略
export type ErrorHandlingPolicy = 'abort' | 'continue' | 'skip_action'

// 执行模式
export type ExecutionMode = 'sync' | 'async'

// 跳过行为
export type SkipBehavior = 'continue' | 'abort'

// 过滤模式
export type FilterMode = 'all' | 'include' | 'exclude'

// 执行阶段配置
export interface InterceptorPhases {
    before: boolean
    after: boolean
}

// 过滤条件
export interface InterceptorFilter {
    mode: FilterMode
    action_types?: string[]
    use_advanced_filter?: boolean
    expressions?: any[]
}

// 错误处理配置
export interface InterceptorErrorConfig {
    before_error_policy: ErrorHandlingPolicy
    after_error_policy: ErrorHandlingPolicy
    max_retries?: number
    retry_delay_seconds?: number
}

// 跳过配置
export interface InterceptorSkipConfig {
    skip_behavior: SkipBehavior
    execute_after_on_skip: boolean
    log_skipped: boolean
}

// 异步执行配置
export interface InterceptorAsyncConfig {
    queue_name?: string
    timeout_seconds?: number
    max_concurrency?: number
    retry_on_error?: boolean
    max_retries?: number
}

// 执行配置
export interface InterceptorExecutionConfig {
    after_mode: ExecutionMode
    async_config?: InterceptorAsyncConfig
}

// 拦截器数据模型
export interface Interceptor {
    id: number
    name: string
    description?: string
    plugin_id: string
    plugin_config?: Record<string, any>
    scope: InterceptorScope
    trigger_id?: number
    extractor_id?: number
    enabled: boolean
    order: number
    phases: InterceptorPhases
    filter: InterceptorFilter
    error_handling: InterceptorErrorConfig
    skip_config: InterceptorSkipConfig
    execution: InterceptorExecutionConfig
    created_at?: string
    updated_at?: string
}

// 创建拦截器请求
export interface CreateInterceptorRequest {
    name: string
    description?: string
    plugin_id: string
    plugin_config?: Record<string, any>
    scope: InterceptorScope
    trigger_id?: number
    extractor_id?: number
    enabled: boolean
    order: number
    phases: InterceptorPhases
    filter: InterceptorFilter
    error_handling: InterceptorErrorConfig
    skip_config: InterceptorSkipConfig
    execution: InterceptorExecutionConfig
}

// 更新拦截器请求
export interface UpdateInterceptorRequest {
    name?: string
    description?: string
    plugin_id?: string
    plugin_config?: Record<string, any>
    enabled?: boolean
    order?: number
    phases?: InterceptorPhases
    filter?: InterceptorFilter
    error_handling?: InterceptorErrorConfig
    skip_config?: InterceptorSkipConfig
    execution?: InterceptorExecutionConfig
}

// 拦截器类型
export type InterceptorType = 'before_only' | 'after_only' | 'around'

// 拦截器插件信息
export interface InterceptorPluginInfo {
    id: string
    name: string
    description: string
    version: string
    type: InterceptorType // 拦截器类型
    supports_before: boolean
    supports_after: boolean
    config_schema?: Record<string, any>
    default_config?: Record<string, any>
}

// 默认拦截器配置
export const defaultInterceptorConfig: Omit<Interceptor, 'id' | 'created_at' | 'updated_at'> = {
    name: '',
    description: '',
    plugin_id: '',
    plugin_config: {},
    scope: 'global',
    enabled: true,
    order: 100,
    phases: {
        before: true,
        after: true,
    },
    filter: {
        mode: 'all',
        action_types: [],
        use_advanced_filter: false,
        expressions: [],
    },
    error_handling: {
        before_error_policy: 'abort',
        after_error_policy: 'continue',
        max_retries: 0,
        retry_delay_seconds: 0,
    },
    skip_config: {
        skip_behavior: 'continue',
        execute_after_on_skip: true,
        log_skipped: true,
    },
    execution: {
        after_mode: 'sync',
    },
}

// 获取拦截器列表
export async function getInterceptors(scope?: InterceptorScope): Promise<Interceptor[]> {
    const queryParams = scope ? `?scope=${scope}` : ''
    return apiClient.get<Interceptor[]>(`/interceptors${queryParams}`)
}

// 获取单个拦截器
export async function getInterceptor(id: number): Promise<Interceptor> {
    return apiClient.get<Interceptor>(`/interceptors/${id}`)
}

// 创建拦截器
export async function createInterceptor(data: CreateInterceptorRequest): Promise<Interceptor> {
    return apiClient.post<Interceptor>('/interceptors', data)
}

// 更新拦截器
export async function updateInterceptor(id: number, data: UpdateInterceptorRequest): Promise<Interceptor> {
    return apiClient.put<Interceptor>(`/interceptors/${id}`, data)
}

// 删除拦截器
export async function deleteInterceptor(id: number): Promise<void> {
    await apiClient.delete(`/interceptors/${id}`)
}

// 启用拦截器
export async function enableInterceptor(id: number): Promise<Interceptor> {
    return apiClient.post<Interceptor>(`/interceptors/${id}/enable`)
}

// 禁用拦截器
export async function disableInterceptor(id: number): Promise<Interceptor> {
    return apiClient.post<Interceptor>(`/interceptors/${id}/disable`)
}

// 获取拦截器插件列表
export async function getInterceptorPlugins(): Promise<InterceptorPluginInfo[]> {
    return apiClient.get<InterceptorPluginInfo[]>('/interceptors/plugins')
}

// 批量更新拦截器顺序
export async function updateInterceptorOrder(orders: Record<string, number>): Promise<void> {
    await apiClient.put('/interceptors/order', orders)
}

// 拦截器执行日志
export interface InterceptorLog {
    id: number
    interceptor_id: number
    interceptor_name: string
    action_id: string
    action_plugin_id: string
    phase: 'before' | 'after' | 'around'
    trigger_id?: number
    email_id?: number
    success: boolean
    error?: string
    duration: number // 毫秒
    input_data?: string
    output_data?: string
    action_result?: string
    decision_made?: string
    created_at: string
}

// 日志过滤条件
export interface InterceptorLogFilter {
    interceptor_id?: number
    trigger_id?: number
    success?: boolean
    phase?: 'before' | 'after' | 'around'
    start_date?: string
    end_date?: string
    page?: number
    limit?: number
}

// 日志列表响应
export interface InterceptorLogListResponse {
    data: InterceptorLog[]
    total: number
    page: number
    limit: number
}

// 日志统计
export interface InterceptorLogStats {
    total: number
    success: number
    failed: number
    average_duration_ms: number
}

// 获取拦截器日志列表
export async function getInterceptorLogs(filter?: InterceptorLogFilter): Promise<InterceptorLogListResponse> {
    const params = new URLSearchParams()
    if (filter) {
        if (filter.interceptor_id !== undefined) params.append('interceptor_id', filter.interceptor_id.toString())
        if (filter.trigger_id !== undefined) params.append('trigger_id', filter.trigger_id.toString())
        if (filter.success !== undefined) params.append('success', filter.success.toString())
        if (filter.phase) params.append('phase', filter.phase)
        if (filter.start_date) params.append('start_date', filter.start_date)
        if (filter.end_date) params.append('end_date', filter.end_date)
        if (filter.page !== undefined) params.append('page', filter.page.toString())
        if (filter.limit !== undefined) params.append('limit', filter.limit.toString())
    }
    const queryString = params.toString()
    return apiClient.get<InterceptorLogListResponse>(`/interceptors/logs${queryString ? `?${queryString}` : ''}`)
}

// 获取单条日志详情
export async function getInterceptorLogById(id: number): Promise<InterceptorLog> {
    return apiClient.get<InterceptorLog>(`/interceptors/logs/${id}`)
}

// 获取日志统计
export async function getInterceptorLogStats(filter?: Omit<InterceptorLogFilter, 'page' | 'limit' | 'success' | 'phase'>): Promise<InterceptorLogStats> {
    const params = new URLSearchParams()
    if (filter) {
        if (filter.interceptor_id !== undefined) params.append('interceptor_id', filter.interceptor_id.toString())
        if (filter.trigger_id !== undefined) params.append('trigger_id', filter.trigger_id.toString())
        if (filter.start_date) params.append('start_date', filter.start_date)
        if (filter.end_date) params.append('end_date', filter.end_date)
    }
    const queryString = params.toString()
    return apiClient.get<InterceptorLogStats>(`/interceptors/logs/stats${queryString ? `?${queryString}` : ''}`)
}
