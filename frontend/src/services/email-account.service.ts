import { apiClient } from '@/lib/api-client';
import {
    EmailAccount,
    CreateEmailAccountRequest,
    UpdateEmailAccountRequest,
    PaginationParams,
    AccountFilterParams,
    PaginatedResponse,
    ProxyAccountMode,
    ProxyFallbackMode,
    ProxyTagFilterMode
} from '@/types';
import type { SyncConfig } from './sync-config.service';

// 同步响应类型
export interface FetchAndStoreResponse {
    status: string;
    sync_mode: string;
    total_emails_processed: number;
    total_new_emails: number;
    processing_time_ms: number;
    mailbox_results: MailboxSyncResult[];
    messages?: string[];
}

// 邮箱同步结果
export interface MailboxSyncResult {
    mailbox_name: string;
    emails_processed: number;
    new_emails: number;
    sync_start_time: string;
    sync_end_time: string;
    previous_sync_end_time?: string;
    error?: string;
}

export interface FetchAndStoreRequest {
    sync_mode?: 'incremental' | 'full';
    mailboxes?: string[];
    max_emails_per_mailbox?: number;
    include_body?: boolean;
    default_start_date?: string;
    end_date?: string;
}

export interface RepairAccountSyncResponse {
    status: 'success' | 'failed';
    account_id: number;
    mailbox: string;
    total_emails_processed: number;
    total_new_emails: number;
    processing_time_ms: number;
    message?: string;
    mailbox_result?: MailboxSyncResult;
}

export interface OAuth2AccountOnboardingRequest extends CreateEmailAccountRequest {
    verify?: boolean;
    run_initial_sync?: boolean;
    create_sync_config?: boolean;
    update_existing?: boolean;
    initial_sync?: FetchAndStoreRequest;
    sync_config?: {
        enable_auto_sync?: boolean;
        sync_interval?: number;
        sync_folders?: string[];
    };
}

export interface OAuth2AccountOnboardingResponse {
    account: EmailAccount;
    created: boolean;
    updated: boolean;
    completed: boolean;
    failed_stage?: string;
    message?: string;
    verification?: unknown;
    initial_sync?: FetchAndStoreResponse;
    sync_config?: SyncConfig;
}

export interface BatchOutlookImportAccountRequest {
    line_number: number;
    email: string;
    password?: string;
    client_id: string;
    access_token?: string;
    refresh_token: string;
    recovery_email?: string;
    recovery_password?: string;
}

export interface BatchOutlookImportOptions {
    verify?: boolean;
    run_initial_sync?: boolean;
    create_sync_config?: boolean;
    update_existing?: boolean;
    create_concurrency?: number;
    verify_concurrency?: number;
    sync_concurrency?: number;
    config_concurrency?: number;
    initial_sync?: FetchAndStoreRequest;
    sync_config?: {
        enable_auto_sync?: boolean;
        sync_interval?: number;
        sync_folders?: string[];
    };
}

export interface BatchOutlookImportRequest {
    accounts: BatchOutlookImportAccountRequest[];
    options?: BatchOutlookImportOptions;
}

export interface BatchOutlookImportAccountResult {
    line_number: number;
    email: string;
    account_id?: number;
    created?: boolean;
    updated?: boolean;
    create_status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
    create_error?: string;
    verify_status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
    verify_error?: string;
    sync_status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
    sync_error?: string;
    sync_new_emails?: number;
    config_status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
    config_error?: string;
}

export interface BatchOutlookImportSummary {
    total: number;
    create_success: number;
    create_error: number;
    verify_success: number;
    verify_error: number;
    verify_skipped: number;
    sync_success: number;
    sync_error: number;
    sync_skipped: number;
    config_success: number;
    config_error: number;
    config_skipped: number;
    total_new_emails: number;
    completed_results: number;
}

export interface BatchOutlookImportJob {
    job_id: string;
    status: 'queued' | 'running' | 'complete' | 'failed';
    stage: string;
    org_id?: number;
    started_at: string;
    updated_at: string;
    finished_at?: string;
    message?: string;
    options: BatchOutlookImportOptions;
    summary: BatchOutlookImportSummary;
    results: BatchOutlookImportAccountResult[];
}

export interface AccountForwardedAddressesResponse {
    accountId: number;
    emailAddress: string;
    forwardedAddresses: string[];
    count: number;
    changed?: boolean;
}

export interface AccountDomainConfigRequest {
    isDomainMail?: boolean;
    enabled?: boolean;
    domain?: string;
}

export interface AccountDomainConfigResponse {
    accountId: number;
    emailAddress: string;
    isDomainMail: boolean;
    domain?: string;
    changed?: boolean;
}

export interface AccountProxyConfigRequest {
    enabled?: boolean;
    useProxy?: boolean;
    proxy?: string;
    proxyMode?: ProxyAccountMode;
    proxyId?: number;
    proxyFallbackMode?: ProxyFallbackMode;
    proxyFallbackProxyId?: number;
    proxyFallbackProxy?: string;
    proxyMatchGroupIds?: number[];
    proxyMatchTagIds?: number[];
    proxyMatchTagMode?: ProxyTagFilterMode;
}

export interface AccountProxyConfigResponse extends AccountProxyConfigRequest {
    accountId: number;
    emailAddress: string;
    enabled: boolean;
    changed?: boolean;
}

export interface AccountExistsResponse {
    exists: boolean;
    emailAddress: string;
    account?: EmailAccount;
    accountId?: number;
}

export interface EmailAliasCapability {
    type: 'gmail_plus' | 'domain_local_part' | 'forwarded';
    domain?: string;
    pattern: string;
    example: string;
    toQuery: string;
}

export interface EmailAliasAccountCapability {
    accountId: number;
    emailAddress: string;
    isDomainMail: boolean;
    domain?: string;
    forwardedAddresses?: string[];
    capabilities: EmailAliasCapability[];
}

export interface EmailAliasCapabilitiesResponse {
    data: EmailAliasAccountCapability[];
    total: number;
}

export class EmailAccountService {
    private basePath = '/accounts';

    /**
     * 获取所有邮箱账户
     */
    async getAccounts(params?: PaginationParams): Promise<EmailAccount[]> {
        // 注意：根据Swagger文档，这个接口返回的是数组，不是分页响应
        const response = await apiClient.get<EmailAccount[]>(
            this.basePath,
            { params }
        );
        return response;
    }

    /**
     * 获取分页的邮箱账户（支持完整过滤参数）
     */
    async getAccountsPaginated(params?: AccountFilterParams): Promise<PaginatedResponse<EmailAccount>> {
        const response = await apiClient.get<PaginatedResponse<EmailAccount>>(
            `${this.basePath}/paginated`,
            { params }
        );
        return response;
    }

    async accountExists(email: string): Promise<AccountExistsResponse> {
        const response = await apiClient.get<AccountExistsResponse>(
            `${this.basePath}/exists`,
            { params: { email } }
        );
        return response;
    }

    async getAliasCapabilities(params?: { type?: string; emailSuffix?: string }): Promise<EmailAliasCapabilitiesResponse> {
        const response = await apiClient.get<EmailAliasCapabilitiesResponse>(
            `${this.basePath}/alias-capabilities`,
            { params }
        );
        return response;
    }

    /**
     * 获取单个邮箱账户
     */
    async getAccount(id: number): Promise<EmailAccount> {
        const response = await apiClient.get<EmailAccount>(`${this.basePath}/${id}`);
        return response;
    }

    /**
     * 创建或更新邮箱账户 (upsert操作)
     * 根据邮箱地址判断是否存在，如果存在则更新，否则创建
     */
    async upsertAccount(data: CreateEmailAccountRequest): Promise<EmailAccount> {
        // 转换为后端期望的格式
        const payload: any = {
            emailAddress: data.email_address,
            authType: data.auth_type || 'password',
            mailProviderId: data.mail_provider_id,
            oauth2ProviderId: data.oauth2_provider_id,
            password: data.password,
            token: data.token,
            proxy: data.proxy,
            proxyMode: data.proxy_mode,
            proxyId: data.proxy_id,
            proxyFallbackMode: data.proxy_fallback_mode,
            proxyFallbackProxyId: data.proxy_fallback_proxy_id,
            proxyFallbackProxy: data.proxy_fallback_proxy,
            proxyMatchGroupIds: data.proxy_match_group_ids,
            proxyMatchTagIds: data.proxy_match_tag_ids,
            proxyMatchTagMode: data.proxy_match_tag_mode,
            isDomainMail: data.is_domain_mail || false,
            domain: data.domain,
            forwardedAddresses: data.forwarded_addresses,
            note: data.note,
            noteFormat: data.note_format,
            customSettings: data.custom_settings
        };

        // 移除未定义的字段
        Object.keys(payload).forEach(key => {
            if (payload[key] === undefined) {
                delete payload[key];
            }
        });

        const response = await apiClient.post<EmailAccount>(
            `${this.basePath}/upsert`,
            payload
        );
        return response;
    }

    /**
     * 创建邮箱账户
     */
    async createAccount(data: CreateEmailAccountRequest): Promise<EmailAccount> {
        // 转换为后端期望的格式
        const payload: any = {
            emailAddress: data.email_address,
            authType: data.auth_type || 'password',
            mailProviderId: data.mail_provider_id,
            oauth2ProviderId: data.oauth2_provider_id,
            password: data.password,
            token: data.token,
            proxy: data.proxy,
            proxyMode: data.proxy_mode,
            proxyId: data.proxy_id,
            proxyFallbackMode: data.proxy_fallback_mode,
            proxyFallbackProxyId: data.proxy_fallback_proxy_id,
            proxyFallbackProxy: data.proxy_fallback_proxy,
            proxyMatchGroupIds: data.proxy_match_group_ids,
            proxyMatchTagIds: data.proxy_match_tag_ids,
            proxyMatchTagMode: data.proxy_match_tag_mode,
            isDomainMail: data.is_domain_mail || false,
            domain: data.domain,
            forwardedAddresses: data.forwarded_addresses,
            note: data.note,
            noteFormat: data.note_format,
            customSettings: data.custom_settings
        };

        // 移除未定义的字段
        Object.keys(payload).forEach(key => {
            if (payload[key] === undefined) {
                delete payload[key];
            }
        });

        const response = await apiClient.post<EmailAccount>(this.basePath, payload);
        return response;
    }

    /**
     * OAuth2 授权完成后，一次性创建/更新账户、验证连接、首次同步并创建同步配置
     */
    async onboardOAuth2Account(data: OAuth2AccountOnboardingRequest): Promise<OAuth2AccountOnboardingResponse> {
        const payload: any = {
            emailAddress: data.email_address,
            authType: data.auth_type || 'oauth2',
            mailProviderId: data.mail_provider_id,
            oauth2ProviderId: data.oauth2_provider_id,
            password: data.password,
            token: data.token,
            proxy: data.proxy,
            proxyMode: data.proxy_mode,
            proxyId: data.proxy_id,
            proxyFallbackMode: data.proxy_fallback_mode,
            proxyFallbackProxyId: data.proxy_fallback_proxy_id,
            proxyFallbackProxy: data.proxy_fallback_proxy,
            proxyMatchGroupIds: data.proxy_match_group_ids,
            proxyMatchTagIds: data.proxy_match_tag_ids,
            proxyMatchTagMode: data.proxy_match_tag_mode,
            isDomainMail: data.is_domain_mail || false,
            domain: data.domain,
            forwardedAddresses: data.forwarded_addresses,
            note: data.note,
            noteFormat: data.note_format,
            customSettings: data.custom_settings,
            verify: data.verify,
            run_initial_sync: data.run_initial_sync,
            create_sync_config: data.create_sync_config,
            update_existing: data.update_existing,
            initial_sync: data.initial_sync,
            sync_config: data.sync_config
        };

        Object.keys(payload).forEach(key => {
            if (payload[key] === undefined) {
                delete payload[key];
            }
        });

        return apiClient.post<OAuth2AccountOnboardingResponse>(
            `${this.basePath}/oauth2/onboard`,
            payload
        );
    }

    /**
     * 启动后台 Outlook 批量导入任务：创建/更新、验证、首次同步、同步配置都由后端继续执行
     */
    async startBatchOutlookImport(data: BatchOutlookImportRequest): Promise<BatchOutlookImportJob> {
        return apiClient.post<BatchOutlookImportJob>(
            `${this.basePath}/batch-outlook-import`,
            data
        );
    }

    /**
     * 查询后台 Outlook 批量导入任务进度
     */
    async getBatchOutlookImportJob(jobId: string): Promise<BatchOutlookImportJob> {
        return apiClient.get<BatchOutlookImportJob>(
            `${this.basePath}/batch-outlook-import/${encodeURIComponent(jobId)}`
        );
    }

    /**
     * 更新邮箱账户
     */
    async updateAccount(id: number, data: UpdateEmailAccountRequest): Promise<EmailAccount> {
        // 转换为后端期望的格式
        const payload: any = {
            emailAddress: data.email_address,
            authType: data.auth_type,
            mailProviderId: data.mail_provider_id,
            oauth2ProviderId: data.oauth2_provider_id,
            password: data.password,
            token: data.token,
            proxy: data.proxy,
            proxyMode: data.proxy_mode,
            proxyId: data.proxy_id,
            proxyFallbackMode: data.proxy_fallback_mode,
            proxyFallbackProxyId: data.proxy_fallback_proxy_id,
            proxyFallbackProxy: data.proxy_fallback_proxy,
            proxyMatchGroupIds: data.proxy_match_group_ids,
            proxyMatchTagIds: data.proxy_match_tag_ids,
            proxyMatchTagMode: data.proxy_match_tag_mode,
            isDomainMail: data.is_domain_mail,
            domain: data.domain,
            forwardedAddresses: data.forwarded_addresses,
            note: data.note,
            noteFormat: data.note_format,
            customSettings: data.custom_settings
        };

        // 移除未定义的字段
        Object.keys(payload).forEach(key => {
            if (payload[key] === undefined) {
                delete payload[key];
            }
        });

        const response = await apiClient.put<EmailAccount>(`${this.basePath}/${id}`, payload);
        return response;
    }

    async getForwardedAddresses(target: { id?: number; email?: string }): Promise<AccountForwardedAddressesResponse> {
        const response = await apiClient.get<AccountForwardedAddressesResponse>(
            this.forwardedAddressesPath(target),
            this.forwardedAddressesConfig(target)
        );
        return response;
    }

    async setForwardedAddresses(target: { id?: number; email?: string }, forwardedAddresses: string[]): Promise<AccountForwardedAddressesResponse> {
        const response = await apiClient.put<AccountForwardedAddressesResponse>(
            this.forwardedAddressesPath(target),
            { forwardedAddresses },
            this.forwardedAddressesConfig(target)
        );
        return response;
    }

    async addForwardedAddress(target: { id?: number; email?: string }, address: string): Promise<AccountForwardedAddressesResponse> {
        const response = await apiClient.post<AccountForwardedAddressesResponse>(
            this.forwardedAddressesPath(target),
            { address },
            this.forwardedAddressesConfig(target)
        );
        return response;
    }

    async removeForwardedAddress(target: { id?: number; email?: string }, address: string): Promise<AccountForwardedAddressesResponse> {
        const response = await apiClient.delete<AccountForwardedAddressesResponse>(
            this.forwardedAddressesPath(target),
            {
                ...this.forwardedAddressesConfig(target),
                data: { address },
            }
        );
        return response;
    }

    async getDomainConfig(target: { id?: number; email?: string }): Promise<AccountDomainConfigResponse> {
        return apiClient.get<AccountDomainConfigResponse>(this.accountConfigPath(target, 'domain-config'));
    }

    async setDomainConfig(target: { id?: number; email?: string }, data: AccountDomainConfigRequest): Promise<AccountDomainConfigResponse> {
        return apiClient.put<AccountDomainConfigResponse>(this.accountConfigPath(target, 'domain-config'), data);
    }

    async clearDomainConfig(target: { id?: number; email?: string }): Promise<AccountDomainConfigResponse> {
        return apiClient.delete<AccountDomainConfigResponse>(this.accountConfigPath(target, 'domain-config'));
    }

    async getProxyConfig(target: { id?: number; email?: string }): Promise<AccountProxyConfigResponse> {
        return apiClient.get<AccountProxyConfigResponse>(this.accountConfigPath(target, 'proxy-config'));
    }

    async setProxyConfig(target: { id?: number; email?: string }, data: AccountProxyConfigRequest): Promise<AccountProxyConfigResponse> {
        return apiClient.put<AccountProxyConfigResponse>(this.accountConfigPath(target, 'proxy-config'), data);
    }

    async clearProxyConfig(target: { id?: number; email?: string }): Promise<AccountProxyConfigResponse> {
        return apiClient.delete<AccountProxyConfigResponse>(this.accountConfigPath(target, 'proxy-config'));
    }

    private forwardedAddressesPath(target: { id?: number; email?: string }): string {
        if (target.id) {
            return `${this.basePath}/${target.id}/forwarded-addresses`;
        }
        return `${this.basePath}/forwarded-addresses`;
    }

    private forwardedAddressesConfig(target: { id?: number; email?: string }): { params?: { email?: string } } | undefined {
        if (!target.id && target.email) {
            return { params: { email: target.email } };
        }
        return undefined;
    }

    private accountConfigPath(target: { id?: number; email?: string }, suffix: 'domain-config' | 'proxy-config'): string {
        if (target.id) {
            return `${this.basePath}/${target.id}/${suffix}`;
        }
        if (target.email) {
            return `${this.basePath}/by-email/${encodeURIComponent(target.email)}/${suffix}`;
        }
        return `${this.basePath}/${suffix}`;
    }

    /**
     * 删除邮箱账户
     */
    async deleteAccount(id: number): Promise<void> {
        await apiClient.delete(`${this.basePath}/${id}`);
    }

    /**
     * 同步邮箱账户（获取并存储邮件）
     */
    async syncAccount(
        id: number,
        options?: {
            sync_mode?: 'incremental' | 'full';
            mailboxes?: string[];
            max_emails_per_mailbox?: number;
            include_body?: boolean;
            default_start_date?: string;
            end_date?: string;
        }
    ): Promise<FetchAndStoreResponse> {
        const response = await apiClient.post<FetchAndStoreResponse>(
            `/account-emails/fetch/${id}`,
            options
        );
        return response;
    }

    /**
     * 修复 Gmail 同步状态：清理失效游标并重新同步最近一个月。
     */
    async repairAccountSync(id: number): Promise<RepairAccountSyncResponse> {
        return apiClient.post<RepairAccountSyncResponse>(
            `${this.basePath}/${id}/repair-sync`,
            {},
            { timeout: 300000 }
        );
    }

    /**
     * 获取账户的增量同步记录
     */
    async getSyncRecords(id: number): Promise<any[]> {
        const response = await apiClient.get<any[]>(`${this.basePath}/${id}/sync-records`);
        return response;
    }

    /**
     * 获取账户的最后一次同步记录
     */
    async getLastSyncRecord(id: number): Promise<any> {
        const response = await apiClient.get<any>(`${this.basePath}/${id}/last-sync-record`);
        return response;
    }

    /**
     * 删除增量同步记录（强制下次完全同步）
     */
    async deleteSyncRecord(id: number, mailbox: string): Promise<void> {
        await apiClient.delete(
            `${this.basePath}/${id}/sync-records`,
            { params: { mailbox } }
        );
    }

    /**
     * 批量同步邮箱账户（如果后端支持）
     */
    async batchSyncAccounts(ids: number[]): Promise<{ results: any[] }> {
        // 注意：这个接口在Swagger文档中没有定义，可能需要后端实现
        const response = await apiClient.post<{ results: any[] }>(
            `${this.basePath}/batch-sync`,
            { account_ids: ids }
        );
        return response;
    }

    /**
     * 测试邮箱连接（如果后端支持）
     */
    async testConnection(data: CreateEmailAccountRequest): Promise<{ success: boolean; message: string }> {
        // 注意：这个接口在Swagger文档中没有定义，可能需要后端实现
        const response = await apiClient.post<{ success: boolean; message: string }>(
            `${this.basePath}/test-connection`,
            data
        );
        return response;
    }

    /**
     * 验证账户连接性
     */
    async verifyAccount(data: {
        account_id?: number;
        email_address?: string;
        password?: string;
        auth_type?: string;
        mail_provider_id?: number;
        custom_settings?: Record<string, string>;
        proxy?: string;
        proxy_mode?: CreateEmailAccountRequest['proxy_mode'];
        proxy_id?: number;
        proxy_fallback_mode?: CreateEmailAccountRequest['proxy_fallback_mode'];
        proxy_fallback_proxy_id?: number;
        proxy_fallback_proxy?: string;
        proxy_match_group_ids?: number[];
        proxy_match_tag_ids?: number[];
        proxy_match_tag_mode?: CreateEmailAccountRequest['proxy_match_tag_mode'];
    }): Promise<{ success: boolean; message: string; error?: string }> {
        const payload: any = {
            ...data,
            proxyMode: data.proxy_mode,
            proxyId: data.proxy_id,
            proxyFallbackMode: data.proxy_fallback_mode,
            proxyFallbackProxyId: data.proxy_fallback_proxy_id,
            proxyFallbackProxy: data.proxy_fallback_proxy,
            proxyMatchGroupIds: data.proxy_match_group_ids,
            proxyMatchTagIds: data.proxy_match_tag_ids,
            proxyMatchTagMode: data.proxy_match_tag_mode,
        }
        Object.keys(payload).forEach(key => {
            if (payload[key] === undefined) {
                delete payload[key]
            }
        })
        const response = await apiClient.post<{ success: boolean; message: string; error?: string }>(
            `${this.basePath}/verify`,
            payload
        );
        return response;
    }

    /**
     * 批量验证账户连接
     */
    async batchVerifyAccounts(accountIds: number[]): Promise<{
        success_count: number;
        error_count: number;
        results: Array<{
            account_id: number;
            email_address: string;
            success: boolean;
            message?: string;
            error?: string;
        }>;
    }> {
        const response = await apiClient.post('/accounts/batch-verify', {
            account_ids: accountIds
        })
        return response
    }

    /**
     * 获取支持的邮件服务商列表
     */
    async getProviders(): Promise<any[]> {
        const response = await apiClient.get<any[]>('/providers');
        return response;
    }

    /**
     * 创建自定义邮件服务商
     */
    async createProvider(data: {
        name: string;
        imapServer: string;
        imapPort: number;
        smtpServer?: string;
        smtpPort?: number;
    }): Promise<any> {
        const response = await apiClient.post<any>('/providers', data);
        return response;
    }
}

// 导出单例实例
export const emailAccountService = new EmailAccountService();
