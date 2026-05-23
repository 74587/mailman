import { apiClient } from '@/lib/api-client'
import {
    EmailTrigger,
    CreateTriggerRequest,
    UpdateTriggerRequest,
    PaginatedTriggersResponse,
    TriggerExecutionLog,
    PaginatedTriggerLogsResponse,
    TriggerStatistics,
    PaginationParams,
    ApiResponse,
    TriggerActionConfig,
    TriggerActionV2,
    TriggerExpression
} from '@/types'

/**
 * Convert V1 actions to V2 format
 */
function adaptActionsToV2(v1Actions: TriggerActionConfig[] | undefined): TriggerActionV2[] {
    if (!v1Actions || v1Actions.length === 0) return [];

    return v1Actions.map((a, index) => {
        // Determine pluginId from type or use type directly as pluginId
        let pluginId = (a as any).pluginId || a.type || 'unknown';
        if (a.type === 'modify_content') pluginId = 'email_modify_plugin';
        if (a.type === 'smtp') pluginId = 'email_forward_plugin';

        // Handle config - could be string or already an object
        let config: Record<string, any> = {};
        if (typeof a.config === 'string') {
            try {
                config = JSON.parse(a.config);
            } catch (e) {
                config = { raw: a.config };
            }
        } else if (typeof a.config === 'object' && a.config !== null) {
            config = a.config as Record<string, any>;
        }

        return {
            id: (a as any).id || `action_${Date.now()}_${index}`,
            pluginId,
            pluginName: (a as any).pluginName || a.name || pluginId,
            config,
            enabled: a.enabled !== undefined ? a.enabled : true,
            executionOrder: (a as any).executionOrder !== undefined ? (a as any).executionOrder : (a.order || index)
        };
    });
}

/**
 * Convert V1 trigger request to V2 format
 */
function adaptRequestToV2(data: Partial<CreateTriggerRequest | UpdateTriggerRequest>): any {
    const v2Request: any = {
        name: data.name,
        description: data.description,
        enabled: data.status === 'enabled',
        expressions: (data as any).expressions || [],
        actions: adaptActionsToV2(data.actions)
    };

    // Remove undefined fields
    Object.keys(v2Request).forEach(key => {
        if (v2Request[key] === undefined) {
            delete v2Request[key];
        }
    });

    return v2Request;
}

/**
 * Convert V2 API response to V1 format for frontend components
 */
function adaptResponseToV1(v2Response: any): EmailTrigger {
    // Actions are already in the response, map them to V1 format
    const actions = (v2Response.actions || []).map((a: any, index: number) => ({
        type: a.pluginId || 'unknown',
        name: a.pluginName || a.pluginId || 'Unknown',
        description: a.description || '',
        config: typeof a.config === 'object' ? JSON.stringify(a.config) : (a.config || '{}'),
        enabled: a.enabled !== undefined ? a.enabled : true,
        order: a.executionOrder !== undefined ? a.executionOrder : index
    }));

    return {
        id: v2Response.id,
        name: v2Response.name,
        description: v2Response.description || '',
        // Map V2 enabled boolean to V1 status string
        status: v2Response.enabled ? 'enabled' : 'disabled',
        // V2 doesn't have these, provide defaults
        check_interval: v2Response.check_interval || 30,
        // Map V2 expressions to V1 expressions
        expressions: v2Response.expressions || [],
        // Map V2 actions to V1 format
        actions: actions,
        // Map V2 condition
        condition: v2Response.condition || { type: 'v2', script: '' },
        enable_logging: v2Response.enable_logging !== undefined ? v2Response.enable_logging : true,
        // Map execution stats (V2 uses camelCase)
        total_executions: v2Response.totalExecutions || 0,
        success_executions: v2Response.successExecutions || 0,
        last_executed_at: v2Response.lastExecutedAt || undefined,
        last_error: v2Response.lastError || undefined,
        // Map timestamps (V2 uses camelCase)
        created_at: v2Response.createdAt || new Date().toISOString(),
        updated_at: v2Response.updatedAt || new Date().toISOString()
    } as EmailTrigger;
}

/**
 * Adapt paginated response to V1 format
 */
function adaptPaginatedResponseToV1(v2Response: any): PaginatedTriggersResponse {
    return {
        data: (v2Response.data || []).map(adaptResponseToV1),
        total: v2Response.total || 0,
        page: v2Response.page || 1,
        limit: v2Response.limit || 10,
        total_pages: v2Response.total_pages || v2Response.totalPages || 1
    };
}

/**
 * Convert V2 trigger execution log response to V1 format
 */
function adaptLogToV1(v2Log: any): TriggerExecutionLog {
    return {
        id: v2Log.id,
        trigger_id: v2Log.triggerId || v2Log.trigger_id,
        trigger: v2Log.trigger,
        // Map execution info
        status: v2Log.status,
        start_time: v2Log.startTime || v2Log.start_time,
        end_time: v2Log.endTime || v2Log.end_time,
        execution_ms: v2Log.duration || v2Log.execution_ms || 0,
        // Map input params
        email_id: v2Log.emailId || v2Log.email_id,
        email: v2Log.email,
        input_params: v2Log.inputParams || v2Log.input_params,
        // Map condition result
        condition_result: v2Log.conditionResult !== undefined ? v2Log.conditionResult : v2Log.condition_result,
        condition_error: v2Log.conditionError || v2Log.condition_error,
        // Map action results
        action_results: v2Log.actionResults || v2Log.action_results || [],
        // Map error message
        error_message: v2Log.error || v2Log.errorMessage || v2Log.error_message,
        // Map execution trace data (base64 encoded)
        execution_trace_data: v2Log.executionTraceData || v2Log.execution_trace_data,
        // Map timestamp
        created_at: v2Log.createdAt || v2Log.created_at
    } as TriggerExecutionLog;
}

/**
 * Adapt paginated log response to V1 format
 */
function adaptPaginatedLogResponseToV1(v2Response: any): PaginatedTriggerLogsResponse {
    return {
        data: (v2Response.data || []).map(adaptLogToV1),
        total: v2Response.total || 0,
        page: v2Response.page || 1,
        limit: v2Response.limit || 10,
        total_pages: v2Response.total_pages || v2Response.totalPages || 1
    };
}

export class TriggerService {
    private static instance: TriggerService
    private baseUrl = '/triggers'

    static getInstance(): TriggerService {
        if (!TriggerService.instance) {
            TriggerService.instance = new TriggerService()
        }
        return TriggerService.instance
    }

    // 获取触发器列表（分页）
    async getTriggers(params?: PaginationParams): Promise<PaginatedTriggersResponse> {
        const queryParams = new URLSearchParams()

        if (params?.page) queryParams.append('page', params.page.toString())
        if (params?.limit) queryParams.append('limit', params.limit.toString())
        if (params?.sort_by) queryParams.append('sort_by', params.sort_by)
        if (params?.sort_order) queryParams.append('sort_order', params.sort_order)
        if (params?.search) queryParams.append('search', params.search)

        const url = queryParams.toString() ? `${this.baseUrl}?${queryParams}` : this.baseUrl
        const response = await apiClient.get<any>(url)
        // Convert V2 response to V1 format
        return adaptPaginatedResponseToV1(response)
    }

    // 获取单个触发器
    async getTrigger(id: number): Promise<EmailTrigger> {
        const response = await apiClient.get<any>(`${this.baseUrl}/${id}`)
        // Convert V2 response to V1 format
        return adaptResponseToV1(response)
    }

    // 创建触发器
    async createTrigger(data: CreateTriggerRequest): Promise<EmailTrigger> {
        // Convert to V2 format before sending
        const v2Data = adaptRequestToV2(data);
        const response = await apiClient.post<any>(this.baseUrl, v2Data)
        // Convert V2 response back to V1 format
        return adaptResponseToV1(response)
    }

    // 更新触发器
    async updateTrigger(id: number, data: UpdateTriggerRequest): Promise<EmailTrigger> {
        // Convert to V2 format before sending
        const v2Data = adaptRequestToV2(data);
        const response = await apiClient.put<any>(`${this.baseUrl}/${id}`, v2Data)
        // Convert V2 response back to V1 format
        return adaptResponseToV1(response)
    }

    // 删除触发器
    async deleteTrigger(id: number): Promise<void> {
        await apiClient.delete(`${this.baseUrl}/${id}`)
    }

    // 启用触发器
    async enableTrigger(id: number): Promise<EmailTrigger> {
        const response = await apiClient.post<any>(`${this.baseUrl}/${id}/enable`)
        return adaptResponseToV1(response)
    }

    // 禁用触发器
    async disableTrigger(id: number): Promise<EmailTrigger> {
        const response = await apiClient.post<any>(`${this.baseUrl}/${id}/disable`)
        return adaptResponseToV1(response)
    }

    // 获取触发器执行日志
    async getTriggerLogs(
        triggerId?: number,
        params?: PaginationParams & {
            status?: string
            start_date?: string
            end_date?: string
        }
    ): Promise<PaginatedTriggerLogsResponse> {
        const queryParams = new URLSearchParams()

        if (triggerId) queryParams.append('trigger_id', triggerId.toString())
        if (params?.page) queryParams.append('page', params.page.toString())
        if (params?.limit) queryParams.append('limit', params.limit.toString())
        if (params?.status) queryParams.append('status', params.status)
        if (params?.start_date) queryParams.append('start_date', params.start_date)
        if (params?.end_date) queryParams.append('end_date', params.end_date)

        const url = queryParams.toString() ? `${this.baseUrl}/logs?${queryParams}` : `${this.baseUrl}/logs`
        const response = await apiClient.get<any>(url)
        // Convert V2 response to V1 format
        return adaptPaginatedLogResponseToV1(response)
    }

    // 获取单个触发器执行日志
    async getTriggerLog(logId: number): Promise<TriggerExecutionLog> {
        const response = await apiClient.get<any>(`${this.baseUrl}/logs/${logId}`)
        // Convert V2 response to V1 format
        return adaptLogToV1(response.data || response)
    }

    // 获取触发器统计信息
    async getTriggerStatistics(
        triggerId: number,
        startDate?: string,
        endDate?: string
    ): Promise<TriggerStatistics> {
        const queryParams = new URLSearchParams()
        if (startDate) queryParams.append('start_date', startDate)
        if (endDate) queryParams.append('end_date', endDate)

        const url = queryParams.toString()
            ? `${this.baseUrl}/${triggerId}/statistics?${queryParams}`
            : `${this.baseUrl}/${triggerId}/statistics`

        const response = await apiClient.get<any>(url)
        // API 可能返回 { data: {...} } 或直接返回统计数据
        const stats = response.data || response
        return stats as TriggerStatistics
    }

    // 测试触发器条件
    async testTriggerCondition(condition: any, emailData: any): Promise<{ result: boolean; error?: string }> {
        const response = await apiClient.post<ApiResponse<{ result: boolean; error?: string }>>(
            `${this.baseUrl}/test-condition`,
            { condition, email_data: emailData }
        )
        return response.data
    }

    // 测试触发器动作
    async testTriggerAction(action: any, emailData: any): Promise<{ result: any; error?: string }> {
        const response = await apiClient.post<ApiResponse<{ result: any; error?: string }>>(
            `${this.baseUrl}/test-action`,
            { action, email_data: emailData }
        )
        return response.data
    }
}

export const triggerService = TriggerService.getInstance()
