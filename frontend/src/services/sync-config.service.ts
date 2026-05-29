import { apiClient } from '@/lib/api-client'

export interface SyncConfig {
    id: number
    account_id: number
    enable_auto_sync: boolean
    sync_interval: number
    sync_folders: string[]
    last_sync_time?: string
    last_sync_end_time?: string
    last_sync_error?: string
    last_error_time?: string
    sync_status: string
    auto_disabled?: boolean
    disable_reason?: string
    consecutive_errors?: number
    recovery_attempts?: number
    last_recovery_attempt?: string
    created_at: string
    updated_at: string
}

export interface TemporarySyncConfig {
    id: number
    account_id: number
    sync_interval: number
    sync_folders: string[]
    expires_at: string
    created_at: string
    updated_at: string
}

export interface CreateTemporarySyncConfigRequest {
    sync_interval: number
    sync_folders: string[]
    duration_minutes: number
}

export interface EffectiveSyncConfigResponse {
    config: SyncConfig
    is_temporary: boolean
    expires_at?: string
}

export interface UpdateSyncConfigRequest {
    enable_auto_sync?: boolean
    sync_interval?: number
    sync_folders?: string[]
}

export interface BatchSyncConfigRequest {
    enable_auto_sync: boolean
    sync_interval: number
    sync_folders?: string[]
}

export interface BatchSyncConfigResponse {
    success_count: number
    error_count: number
    errors: Array<{
        account_id: number
        email_address: string
        error: string
    }>
}

export const syncConfigService = {
    // 获取账户的同步配置
    async getAccountSyncConfig(accountId: number): Promise<SyncConfig> {
        const response = await apiClient.get<SyncConfig>(`/accounts/${accountId}/sync-config`)
        return response
    },

    // 创建账户的同步配置
    async createAccountSyncConfig(accountId: number, data: UpdateSyncConfigRequest): Promise<SyncConfig> {
        const response = await apiClient.post<SyncConfig>(`/accounts/${accountId}/sync-config`, data)
        return response
    },

    // 更新账户的同步配置
    async updateAccountSyncConfig(accountId: number, data: UpdateSyncConfigRequest): Promise<SyncConfig> {
        const response = await apiClient.put<SyncConfig>(`/accounts/${accountId}/sync-config`, data)
        return response
    },

    // 删除账户的同步配置
    async deleteAccountSyncConfig(accountId: number): Promise<void> {
        await apiClient.delete(`/accounts/${accountId}/sync-config`)
    },

    // 获取账户的有效同步配置（考虑三级优先级）
    async getEffectiveSyncConfig(accountId: number): Promise<EffectiveSyncConfigResponse> {
        const response = await apiClient.get<EffectiveSyncConfigResponse>(`/accounts/${accountId}/sync-config/effective`)
        return response
    },

    // 创建临时同步配置
    async createTemporarySyncConfig(accountId: number, data: CreateTemporarySyncConfigRequest): Promise<TemporarySyncConfig> {
        const response = await apiClient.post<TemporarySyncConfig>(`/accounts/${accountId}/sync-config/temporary`, data)
        return response
    },

    // 立即同步
    async syncNow(accountId: number): Promise<{
        success: boolean
        emails_synced: number
        duration: string
        error?: string
    }> {
        const response = await apiClient.post(`/accounts/${accountId}/sync-now`)
        return response
    },

    // 获取全局同步配置
    async getGlobalSyncConfig(): Promise<{
        default_enable_sync: boolean
        default_sync_interval: number
        default_sync_folders: string[]
        max_sync_workers: number
        max_emails_per_sync: number
    }> {
        const response = await apiClient.get('/sync/global-config')
        return response
    },

    // 更新全局同步配置
    async updateGlobalSyncConfig(data: {
        default_enable_sync?: boolean
        default_sync_interval?: number
        default_sync_folders?: string[]
        max_sync_workers?: number
        max_emails_per_sync?: number
    }): Promise<any> {
        const response = await apiClient.put('/sync/global-config', data)
        return response
    },

    // 批量创建或更新账户同步配置
    async batchCreateOrUpdateAccountSyncConfig(accountIds: number[], data: BatchSyncConfigRequest): Promise<BatchSyncConfigResponse> {
        const response = await apiClient.post<BatchSyncConfigResponse>('/sync/batch-config', {
            account_ids: accountIds,
            ...data
        })
        return response
    },

    // 获取所有账户的同步状态（包含配置信息）
    async getAllAccountSyncStatuses(): Promise<AccountSyncStatus[]> {
        const response = await apiClient.get<{ success: boolean; data: AccountSyncStatus[] }>('/sync/account-status?include_config=true')
        return response.data || []
    },

    // 获取单个账户的同步状态
    async getAccountSyncStatus(accountId: number): Promise<AccountSyncStatus | null> {
        const response = await apiClient.get<{ success: boolean; data: AccountSyncStatus | null }>(`/sync/account-status?account_id=${accountId}&include_config=true`)
        return response.data
    }
}

// 账户同步状态类型（包含数据库配置和运行时状态）
export interface AccountSyncStatus {
    account_id: number
    account_email: string
    enable_auto_sync: boolean
    sync_interval: number
    sync_status: string // idle, syncing, error
    auto_disabled: boolean
    disable_reason?: string
    consecutive_errors: number
    last_sync_error?: string
    last_sync_time?: string
    last_sync_end_time?: string
    last_error_time?: string
    // 运行时状态（从同步器获取）
    is_running?: boolean
    sync_count?: number
    error_count?: number
    next_sync_time?: string
    is_temporary?: boolean
    temporary_expires_at?: string
}
