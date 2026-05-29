import { apiClient } from '@/lib/api-client'
import type { Email } from '@/types'

// ============ Request Types ============

export interface PickupPollRequest {
    account_id?: number         // 可选但推荐传；to_query 能解析到账户时以后端解析结果为准
    keep_alive_seconds: number  // 临时同步覆盖有效期(秒)，建议 30-120
    sync_interval: number       // 后端拉取邮件间隔(秒)，默认 5
    since: string               // ISO8601 搜索起始时间
    to_query?: string           // 收件人过滤
    limit?: number              // 返回数量限制，默认 10

    // 提取模式（三选一，可都不传表示只搜索不提取）
    template_id?: number        // 方式1: 引用已有V2模板
    inline_actions?: InlineActionsConfig  // 方式2: 内联V2动作
    simple_extract?: SimpleExtractConfig  // 方式3: 简单提取（V1风格）
}

export interface InlineActionsConfig {
    expressions?: unknown[]
    actions: unknown[]
    output_config: unknown
}

export interface SimpleExtractConfig {
    field: string       // body, subject, from, html_body
    type: string        // regex, js, gotemplate
    pattern: string     // 正则表达式或脚本
    match_mode?: 'all' | 'first' | 'last' | 'index'
    match_index?: number
}

// ============ Response Types ============

export interface PickupPollResponse {
    success: boolean
    account_id: number
    requested_account_id?: number
    resolved_by?: 'account_id' | 'to_query'
    emails: Email[]
    new_count: number
    extractions?: ExtractionResultItem[]
    sync_active: boolean
    sync_expires_at: string
}

export interface ExtractionResultItem {
    email_id: number
    success: boolean
    status: 'success' | 'failed' | 'no_match' | 'skipped'
    extracted_value?: unknown
    error?: string
}

// ============ Service ============

export const pickupService = {
    /**
     * 统一取件轮询
     * 合并「续期同步」「搜索邮件」「执行提取」为一个原子操作
     */
    async poll(request: PickupPollRequest): Promise<PickupPollResponse> {
        return apiClient.post<PickupPollResponse>('/pickup/poll', request)
    },
}
