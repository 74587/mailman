import { logger } from '@/lib/logger';
import { apiClient } from '@/lib/api-client'
import { Email } from '@/types'

// 邮件搜索参数
export interface EmailSearchParams {
    limit?: number
    offset?: number
    sort_by?: string
    cursor?: boolean
    after_cursor?: string
    before_cursor?: string
    anchor_email_id?: number
    start_date?: string
    end_date?: string
    from_query?: string
    to_query?: string
    cc_query?: string
    subject_query?: string
    body_query?: string
    html_query?: string
    keyword?: string
    mailbox?: string
    direction?: string // 'received' | 'sent' | 'all'
}

// 提取请求类型
export interface ExtractEmailsRequest {
    extractors: ExtractorConfig[];
    // 搜索参数
    start_date?: string;
    end_date?: string;
    from_query?: string;
    to_query?: string;
    cc_query?: string;
    subject_query?: string;
    body_query?: string;
    html_query?: string;
    keyword?: string;
    mailbox?: string;
    // 分页和处理选项
    limit?: number;
    offset?: number;
    sort_by?: string;
    batch_size?: number;
}

// 提取器配置
export interface ExtractorConfig {
    type: 'regex' | 'js' | 'gotemplate';
    field: 'ALL' | 'from' | 'to' | 'cc' | 'subject' | 'body' | 'html_body' | 'headers';
    config: string;
}

// 提取结果
export interface ExtractorResult {
    email_id: number;
    email_subject: string;
    email_from: string;
    email_date: string;
    matches: string[];
}

// 提取响应
export interface ExtractEmailsResponse {
    results: ExtractorResult[];
    summary: {
        total_emails_processed: number;
        total_matches_found: number;
        processing_time_ms: number;
    };
}

// 等待邮件请求
export interface WaitEmailRequest {
    accountId?: number;
    email?: string;
    timeout?: number;
    interval?: number;
    start_time?: string;
    extract?: ExtractorConfig[];
}

// 等待邮件响应
export interface WaitEmailResponse {
    status: string;
    found: boolean;
    email?: Email;
    matches?: string[];
    message: string;
    elapsed_time: number;
    checks_performed: number;
}

// 随机邮件响应
export interface RandomEmailResponse {
    email: string;
    status?: string;
    raw_email?: string;
    email_type?: 'regular' | 'alias' | 'domain';
    account_id?: number;
    message?: string;
    originalEmail?: string;
    accountId?: number;
    isAlias?: boolean;
    isDomain?: boolean;
}

export interface RandomEmailParams {
    alias?: boolean;
    domain?: boolean;
    accountId?: number;
    emailSuffix?: string;
    prefixStrategy?: 'literal' | 'builtin' | 'template' | 'random';
    prefix?: string;
    prefixTemplate?: string;
    builtinPrefix?: string;
    randomLength?: number;
}

// 同步请求
export interface FetchAndStoreRequest {
    sync_mode?: 'incremental' | 'full';
    mailboxes?: string[];
    default_start_date?: string;
    end_date?: string;
    max_emails_per_mailbox?: number;
    include_body?: boolean;
}

// 同步响应
export interface FetchAndStoreResponse {
    status: string;
    sync_mode: string;
    mailbox_results: MailboxSyncResult[];
    total_emails_processed: number;
    total_new_emails: number;
    processing_time_ms: number;
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

// 邮件统计响应
export interface EmailStatsResponse {
    // 账户统计
    totalAccounts: number;
    verifiedAccounts: number;
    syncingAccounts: number;
    errorAccounts: number;
    // 邮件统计
    totalEmails: number;
    unreadEmails: number;
    todayEmails: number;
    totalGrowthRate: number;  // 总邮件增长率
    todayGrowthRate: number;  // 今日邮件增长率
    // 触发器统计
    totalTriggers: number;
    enabledTriggers: number;
}

class EmailService {
    // 获取账户邮件列表
    async getEmails(accountId: number, params: EmailSearchParams = {}) {
        const queryParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== '') {
                queryParams.append(key, value.toString())
            }
        })

        const response = await apiClient.get(`/account-emails/list/${accountId}?${queryParams}`)
        logger.debug(response)
        return response
    }

    // 获取单个邮件详情
    async getEmail(emailId: number) {
        const response = await apiClient.get(`/emails/${emailId}`)
        return response
    }

    // 提取邮件内容（全局）
    async extractEmails(request: ExtractEmailsRequest): Promise<ExtractEmailsResponse> {
        const response = await apiClient.post('/emails/extract', request)
        return response.data
    }

    // 提取账户邮件内容
    async extractAccountEmails(accountId: number, request: ExtractEmailsRequest): Promise<ExtractEmailsResponse> {
        const response = await apiClient.post(`/account-emails/extract/${accountId}`, request)
        return response.data
    }

    // 等待邮件到达
    async waitForEmail(params: WaitEmailRequest): Promise<WaitEmailResponse> {
        const queryParams = new URLSearchParams()
        if (params.accountId) queryParams.append('accountId', params.accountId.toString())
        if (params.email) queryParams.append('email', params.email)
        if (params.timeout) queryParams.append('timeout', params.timeout.toString())
        if (params.interval) queryParams.append('interval', params.interval.toString())
        if (params.start_time) queryParams.append('start_time', params.start_time)

        const response = await apiClient.get(`/wait-email?${queryParams}`, {
            data: params.extract ? { extract: params.extract } : undefined
        })
        return response.data
    }

    // 获取随机邮件账户
    async getRandomEmail(params: RandomEmailParams = {}): Promise<RandomEmailResponse> {
        const queryParams = new URLSearchParams()
        if (params.alias) queryParams.append('alias', 'true')
        if (params.domain) queryParams.append('domain', 'true')
        if (params.accountId) queryParams.append('accountId', String(params.accountId))
        if (params.emailSuffix) queryParams.append('emailSuffix', params.emailSuffix)
        if (params.prefixStrategy) queryParams.append('prefixStrategy', params.prefixStrategy)
        if (params.prefix) queryParams.append('prefix', params.prefix)
        if (params.prefixTemplate) queryParams.append('prefixTemplate', params.prefixTemplate)
        if (params.builtinPrefix) queryParams.append('builtinPrefix', params.builtinPrefix)
        if (params.randomLength) queryParams.append('randomLength', String(params.randomLength))

        return apiClient.get<RandomEmailResponse>(`/random-email?${queryParams}`)
    }

    // 同步账户邮件
    async fetchAndStoreEmails(accountId: number, request: FetchAndStoreRequest = {}): Promise<FetchAndStoreResponse> {
        const response = await apiClient.post(`/account-emails/fetch/${accountId}`, request)
        return response.data
    }

    // 高级邮件获取（支持智能匹配）
    async fetchEmails(request: any) {
        const response = await apiClient.post('/fetch-emails', request)
        return response.data
    }

    // 搜索邮件（支持可选账户ID和to_query参数）
    async searchEmails(params: EmailSearchParams = {}, accountId?: number) {
        logger.debug('📧 searchEmails 调用，参数:', {
            params,
            accountId,
            hasToQuery: !!params.to_query
        })

        const queryParams = new URLSearchParams()

        // 添加账户ID（如果有）
        if (accountId !== undefined) {
            queryParams.append('account_id', accountId.toString())
        }

        // 添加其他搜索参数
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== '') {
                logger.debug(`添加查询参数: ${key}=${value}`)
                queryParams.append(key, value.toString())
            }
        })

        const apiUrl = `/emails/search?${queryParams}`
        logger.debug('🔍 最终API URL:', apiUrl)
        logger.debug('🔍 查询参数详情:', queryParams.toString())

        try {
            // 使用新的搜索API
            const response = await apiClient.get(apiUrl)
            logger.debug('✅ Search emails API 响应成功:', response)
            return response
        } catch (error) {
            console.error('❌ Search emails API 错误:', error)
            throw error
        }
    }

    // 获取邮件统计数据
    async getEmailStats(): Promise<EmailStatsResponse> {
        const response = await apiClient.get('/dashboard/stats')
        return response
    }

    // 获取所有账户的邮件列表
    async getAllEmails(params: EmailSearchParams = {}) {
        const queryParams = new URLSearchParams()
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== '') {
                queryParams.append(key, value.toString())
            }
        })

        const response = await apiClient.get(`/account-emails/list/all?${queryParams}`)
        return response
    }

    // 获取所有邮件文件夹
    async getEmailFolders() {
        const response = await apiClient.get('/account-emails/folders')
        return response
    }
}

export const emailService = new EmailService()
