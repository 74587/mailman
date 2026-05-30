import { apiClient } from '@/lib/api-client';
import {
    EmailAccount,
    CreateEmailAccountRequest,
    UpdateEmailAccountRequest,
    PaginationParams,
    AccountFilterParams,
    PaginatedResponse
} from '@/types';

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
    mailbox: string;
    emails_processed: number;
    new_emails: number;
    last_sync_time?: string;
    error?: string;
}

export interface AccountForwardedAddressesResponse {
    accountId: number;
    emailAddress: string;
    forwardedAddresses: string[];
    count: number;
    changed?: boolean;
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
     * 更新邮箱账户
     */
    async updateAccount(id: number, data: UpdateEmailAccountRequest): Promise<EmailAccount> {
        // 转换为后端期望的格式
        const payload: any = {
            emailAddress: data.email_address,
            authType: data.auth_type,
            mailProviderId: data.mail_provider_id,
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
