// API Response Types
export interface ApiResponse<T> {
    data: T;
    error?: string;
    message?: string;
}

// Email Account Types - 匹配后端API响应
export type AccountNoteFormat = 'markdown' | 'html';
export type ProxyType = 'http' | 'https' | 'ssh' | 'socks5';
export type ProxyStatus = 'unknown' | 'available' | 'unavailable' | 'checking';
export type ProxyAccountMode = 'manual' | 'selected' | 'auto';
export type ProxyFallbackMode = 'interrupt' | 'manual_backup' | 'auto_select';
export type ProxyTagFilterMode = 'and' | 'or';

export interface ProxyGroup {
    id: number;
    orgId?: number;
    name: string;
    description?: string;
    color?: string;
    sortOrder?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface ProxyTag {
    id: number;
    orgId?: number;
    name: string;
    color?: string;
    sortOrder?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface ProxyPoolItem {
    id: number;
    orgId?: number;
    type: ProxyType;
    host: string;
    port: number;
    username?: string;
    password?: string;
    refreshUrl?: string;
    remark?: string;
    groupId?: number;
    group?: ProxyGroup;
    tags?: ProxyTag[];
    status: ProxyStatus;
    lastCheckAt?: string;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastError?: string;
    checkLatencyMs?: number;
    exitIp?: string;
    country?: string;
    region?: string;
    city?: string;
    isp?: string;
    checkCount?: number;
    successCount?: number;
    failureCount?: number;
    trafficBytesIn?: number;
    trafficBytesOut?: number;
    usageScope?: string;
    source?: string;
    metadata?: Record<string, any>;
    createdAt?: string;
    updatedAt?: string;
}

export interface ProxyAccountSettings {
    proxyMode?: ProxyAccountMode;
    proxyId?: number;
    proxyFallbackMode?: ProxyFallbackMode;
    proxyFallbackProxyId?: number;
    proxyFallbackProxy?: string;
    proxyMatchGroupIds?: number[];
    proxyMatchTagIds?: number[];
    proxyMatchTagMode?: ProxyTagFilterMode;
}

export interface EmailAccount {
    id: number;
    emailAddress: string;
    authType: 'password' | 'oauth2' | 'app_password';
    password?: string;
    token?: string;
    mailProviderId: number;
    mailProvider?: {
        id: number;
        name: string;
        type: string;
        imapServer: string;
        imapPort: number;
        smtpServer: string;
        smtpPort: number;
        createdAt: string;
        updatedAt: string;
        deletedAt?: {
            time: string;
            valid: boolean;
        };
    };
    proxy?: string;
    proxyMode?: ProxyAccountMode;
    proxyId?: number;
    proxyPoolItem?: ProxyPoolItem;
    proxyFallbackMode?: ProxyFallbackMode;
    proxyFallbackProxyId?: number;
    proxyFallbackProxy?: string;
    proxyMatchGroupIds?: number[];
    proxyMatchTagIds?: number[];
    proxyMatchTagMode?: ProxyTagFilterMode;
    oauth2ProviderId?: number;
    oauth2Provider?: OAuth2GlobalConfig;
    isDomainMail: boolean;
    domain?: string;
    forwardedAddresses?: string[];
    note?: string;
    noteFormat?: AccountNoteFormat;
    customSettings?: Record<string, any>;
    isVerified?: boolean;
    verifiedAt?: string;
    createdAt: string;
    updatedAt: string;
    deletedAt?: {
        time: string;
        valid: boolean;
    };
    // 前端添加的字段
    status?: 'active' | 'inactive' | 'error';
    lastSync?: string;
    lastSyncAt?: string;  // 后端返回的字段名
    // 错误状态
    errorStatus?: string;
    errorMessage?: string;
    // 标签 - 从后端返回的Tag结构
    tags?: Tag[];
}

// 前端显示用的简化类型
export interface EmailAccountDisplay {
    id: number;
    email: string;
    provider: string;
    auth_type: 'password' | 'oauth2' | 'app_password';
    username?: string;
    status: 'active' | 'inactive' | 'error';
    last_sync?: string;
    use_proxy?: boolean;
    proxy_url?: string;
    proxy_username?: string;
    created_at: string;
    updated_at: string;
}

export interface CreateEmailAccountRequest {
    email_address: string;
    password?: string;
    auth_type?: 'password' | 'oauth2' | 'app_password';
    app_password?: string;
    token?: string;
    mail_provider_id?: number;
    oauth2_provider_id?: number;
    proxy?: string;
    proxy_mode?: ProxyAccountMode;
    proxy_id?: number;
    proxy_fallback_mode?: ProxyFallbackMode;
    proxy_fallback_proxy_id?: number;
    proxy_fallback_proxy?: string;
    proxy_match_group_ids?: number[];
    proxy_match_tag_ids?: number[];
    proxy_match_tag_mode?: ProxyTagFilterMode;
    is_domain_mail?: boolean;
    domain?: string;
    forwarded_addresses?: string[];
    note?: string;
    note_format?: AccountNoteFormat;
    custom_settings?: Record<string, any>;
}

export interface UpdateEmailAccountRequest extends Partial<CreateEmailAccountRequest> {
    id: number;
}

// Email Types - 匹配后端API响应
export interface Email {
    ID: number;
    MessageID: string;
    AccountID: number;
    Subject: string;
    From: string[];
    To: string[];
    Cc?: string[] | null;
    Bcc?: string[] | null;
    Date: string;
    Body: string;
    HTMLBody?: string;
    RawMessage?: string; // 原始邮件报文
    Attachments?: EmailAttachment[] | null;
    HasAttachments?: boolean; // 是否有附件
    MailboxName: string;
    Flags?: string[];
    Size: number;
    CreatedAt: string;
    UpdatedAt: string;
    DeletedAt?: {
        time: string;
        valid: boolean;
    } | null;
    Account?: any;
}

export interface EmailAttachment {
    // snake_case (legacy/frontend style)
    id?: number;
    email_id?: number;
    filename?: string;
    content_type?: string;
    size?: number;
    content?: string;
    // PascalCase (API response style)
    ID?: number;
    EmailID?: number;
    Filename?: string;
    MIMEType?: string;
    ContentType?: string;
    Size?: number;
    Content?: string;
}

export interface Attachment {
    id: number;
    email_id: number;
    filename: string;
    content_type: string;
    size: number;
    content?: string;
}

// Fetch Emails Types
export interface FetchEmailsRequest {
    folder?: string;
    limit?: number;
    since_date?: string;
    before_date?: string;
    subject_filter?: string;
    sender_filter?: string;
    unread_only?: boolean;
    with_attachments_only?: boolean;
    mark_as_read?: boolean;
    delete_after_fetch?: boolean;
    use_incremental_sync?: boolean;
    extract_content?: ExtractContentConfig;
}

export interface ExtractContentConfig {
    patterns?: ExtractPattern[];
}

export interface ExtractPattern {
    name: string;
    type: 'regex' | 'javascript' | 'go_template';
    pattern: string;
    flags?: string;
}

// Mail Provider Types
export interface MailProvider {
    id: number;
    name: string;
    imap_host: string;
    imap_port: number;
    imap_use_ssl: boolean;
    smtp_host?: string;
    smtp_port?: number;
    smtp_use_ssl?: boolean;
    oauth2_enabled: boolean;
    oauth2_auth_url?: string;
    oauth2_token_url?: string;
    oauth2_client_id?: string;
    oauth2_scopes?: string[];
}

// Wait Email Types
export interface WaitEmailRequest {
    email?: string;
    provider?: string;
    password?: string;
    app_password?: string;
    timeout?: number;
    folder?: string;
    subject_contains?: string;
    from_contains?: string;
    to_contains?: string;
    extract_content?: ExtractContentConfig;
}

// Statistics Types
export interface EmailStatistics {
    total_emails: number;
    unread_emails: number;
    today_emails: number;
    accounts_count: number;
    active_accounts: number;
    last_sync_time?: string;
}

// Sync Types
export interface SyncStatus {
    account_id: number;
    status: 'idle' | 'syncing' | 'error';
    progress?: number;
    message?: string;
    last_sync?: string;
    emails_fetched?: number;
}

// Filter Types
export interface EmailFilter {
    account_id?: number;
    folder?: string;
    search?: string;
    unread_only?: boolean;
    has_attachments?: boolean;
    date_from?: string;
    date_to?: string;
    sender?: string;
    subject?: string;
}

// Pagination Types
export interface PaginationParams {
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    search?: string;  // 添加搜索字段，用于邮箱地址模糊查询
    status?: string;  // 添加状态字段，用于状态过滤
    cursor?: boolean;
    after_cursor?: string;
    before_cursor?: string;
    anchor_account_id?: number;
}

// 账户过滤参数 (扩展后端支持的所有参数)
export interface AccountFilterParams extends PaginationParams {
    provider_id?: number;      // 按供应商ID过滤
    tag_ids?: string;          // 按标签ID过滤，逗号分隔
    tag_filter_mode?: 'or' | 'and';  // 标签过滤模式
    is_verified?: boolean;     // 按验证状态过滤
    error_status?: string;     // 按错误状态过滤
    created_after?: string;    // 创建时间起始 (RFC3339)
    created_before?: string;   // 创建时间结束 (RFC3339)
    last_sync_after?: string;  // 最后同步时间起始 (RFC3339)
    last_sync_before?: string; // 最后同步时间结束 (RFC3339)
}

export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    total_pages: number;
    has_next?: boolean;
    has_prev?: boolean;
    next_cursor?: string;
    prev_cursor?: string;
    cursor_mode?: boolean;
    anchor_index?: number;
    window_start_index?: number;
    window_end_index?: number;
}

// 转换函数：将API响应转换为前端显示格式
export function convertToDisplayAccount(account: EmailAccount): EmailAccountDisplay {
    return {
        id: account.id,
        email: account.emailAddress,
        provider: account.mailProvider?.name || account.mailProvider?.type || 'Unknown',
        auth_type: account.authType,
        status: 'active', // 默认状态，可以根据其他字段判断
        last_sync: account.lastSync,
        use_proxy: !!account.proxy,
        proxy_url: account.proxy,
        created_at: account.createdAt,
        updated_at: account.updatedAt,
    };
}

// 取件模板相关类型
export interface ExtractorConfig {
    field: 'ALL' | 'from' | 'to' | 'cc' | 'subject' | 'body' | 'html_body' | 'headers'
    type: 'regex' | 'js' | 'gotemplate'
    match?: string  // 可选的匹配条件
    extract: string // 提取规则（替换原来的config字段）
    config?: string // 保留用于向后兼容
    replacement?: string // 正则表达式的替换模板（如 $0, $1 等）
}

export interface ExtractResult {
    field: string
    value: string
    confidence?: number
}

export interface ExtractorTemplate {
    id: number
    name: string
    description?: string
    extractors: ExtractorConfig[]
    created_at: string
    updated_at: string
}

export interface ExtractorTemplateRequest {
    name: string
    description?: string
    extractors: ExtractorConfig[]
}

export interface PaginatedExtractorTemplatesResponse {
    data: ExtractorTemplate[]
    total: number
    page: number
    limit: number
    total_pages: number
}

// 触发器相关类型
export type TriggerStatus = 'enabled' | 'disabled'
export type TriggerActionType = 'modify_content' | 'smtp'
export type TriggerExecutionStatus = 'success' | 'failed' | 'partial'

export interface TriggerConditionConfig {
    type: string // js, gotemplate
    script: string // 脚本内容
    timeout?: number // 超时时间（秒）
}

export interface TriggerActionConfig {
    type: TriggerActionType // 动作类型
    name: string // 动作名称
    description?: string // 动作描述
    config: string // 动作配置（JSON字符串或模板）
    enabled: boolean // 是否启用此动作
    order: number // 执行顺序
}

export interface EmailTrigger {
    id: number
    name: string // 触发器名称
    description?: string // 触发器描述
    status: TriggerStatus // 触发器状态

    // 检查配置
    check_interval: number // 检查间隔（秒）

    // 过滤参数（复用EmailFilter结构）
    expressions?: TriggerExpression[] // V2 表达式树 (UI支持)
    email_address?: string // 邮箱地址过滤
    start_date?: string // 开始日期
    end_date?: string // 结束日期
    subject?: string // 主题过滤
    from?: string // 发件人过滤
    to?: string // 收件人过滤
    has_attachment?: boolean // 是否有附件
    unread?: boolean // 是否未读
    labels?: string[] // 标签过滤
    folders?: string[] // 文件夹列表
    custom_filters?: Record<string, string> // 自定义过滤器

    // 触发条件和动作
    condition: TriggerConditionConfig // 触发条件
    actions: TriggerActionConfig[] // 触发动作

    // 日志配置
    enable_logging: boolean // 是否启用日志

    // 统计信息
    total_executions: number // 总执行次数
    success_executions: number // 成功执行次数
    last_executed_at?: string // 最后执行时间
    last_error?: string // 最后错误信息

    // 时间戳
    created_at: string
    updated_at: string
    deleted_at?: string
}

export interface CreateTriggerRequest {
    name: string
    description?: string
    check_interval: number
    email_address?: string
    subject?: string
    from?: string
    to?: string
    has_attachment?: boolean
    unread?: boolean
    labels?: string[]
    folders?: string[]
    custom_filters?: Record<string, string>
    condition: TriggerConditionConfig
    actions: TriggerActionConfig[]
    enable_logging: boolean
    status: TriggerStatus
}

export interface UpdateTriggerRequest extends Partial<CreateTriggerRequest> {
    id: number
}

export interface TriggerActionResult {
    action_name: string
    action_type: string
    success: boolean
    error?: string
    input_data?: any
    output_data?: any
    execution_ms: number
}

// ExecutionStep 执行追踪中的单个步骤
export interface ExecutionStep {
    id: string
    type: 'filter' | 'action'
    name: string
    pluginId: string
    startTime: string
    endTime: string
    duration: number  // 毫秒
    success: boolean
    input: Record<string, any>
    output: Record<string, any>
    error?: string
}

// ExecutionTrace 完整的执行追踪
export interface ExecutionTrace {
    steps: ExecutionStep[]
    totalSteps: number
    startTime: string
    endTime: string
    totalMs: number
}

export interface TriggerExecutionLog {
    id: number
    trigger_id: number
    trigger?: EmailTrigger

    // 执行信息
    status: TriggerExecutionStatus
    start_time: string
    end_time: string
    execution_ms: number

    // 输入参数
    email_id: number
    email?: Email
    input_params?: Record<string, any> // 触发器入口参数

    // 条件校验结果
    condition_result: boolean
    condition_error?: string

    // 动作执行结果
    action_results: TriggerActionResult[]

    // 错误信息
    error_message?: string

    // 执行追踪数据 (Base64 编码的 JSON)
    execution_trace_data?: string

    // 时间戳
    created_at: string
}

export interface PaginatedTriggersResponse {
    data: EmailTrigger[]
    total: number
    page: number
    limit: number
    total_pages: number
}

export interface PaginatedTriggerLogsResponse {
    data: TriggerExecutionLog[]
    total: number
    page: number
    limit: number
    total_pages: number
}

export interface TriggerStatistics {
    total_executions: number
    success_executions: number
    failed_executions: number
    partial_executions: number
    avg_execution_time: number
    success_rate: number
    max_execution_time: number
    min_execution_time: number
    avg_condition_time: number
    avg_action_time: number
    execution_time_percentiles: {
        p50: number
        p90: number
        p95: number
        p99: number
    }
    resource_usage?: {
        avg_memory_mb: number
        max_memory_mb: number
        avg_cpu_percent: number
        max_cpu_percent: number
    }
    time_distribution?: {
        labels: string[]
        values: number[]
    }
    executions_by_day?: {
        dates: string[]
        counts: number[]
        success_counts: number[]
        failed_counts: number[]
    }
}

// OAuth2 Types
export type OAuth2ProviderType = string

export interface OAuth2GlobalConfig {
    id: number
    name: string
    provider_type: OAuth2ProviderType
    client_id: string
    client_secret: string
    redirect_uri: string
    scopes: string[]
    is_enabled: boolean
    is_default: boolean
    created_at: string
    updated_at: string
}

export interface CreateOAuth2ConfigRequest {
    name: string
    provider_type: OAuth2ProviderType
    client_id: string
    client_secret: string
    redirect_uri: string
    scopes: string[]
    is_enabled: boolean
    is_default?: boolean
}

export interface UpdateOAuth2ConfigRequest extends Partial<CreateOAuth2ConfigRequest> {
    id: number
}

export interface OAuth2AuthUrlRequest {
    provider: OAuth2ProviderType
    state?: string
}

export interface OAuth2AuthUrlResponse {
    auth_url: string
    state: string
}

export interface OAuth2TokenExchangeRequest {
    provider: OAuth2ProviderType
    code: string
    state: string
    config_id?: number  // Optional: specific OAuth2 config to use
}

export interface OAuth2TokenResponse {
    access_token: string
    refresh_token?: string
    token_type: string
    expires_in: number
    scope?: string
}

export interface OAuth2RefreshTokenRequest {
    provider: OAuth2ProviderType
    refresh_token: string
    config_id?: number  // Optional: specific OAuth2 config to use
}


export interface OAuth2AuthUrlRequest {
    provider: OAuth2ProviderType
    redirect_uri?: string
}

export interface OAuth2AuthUrlResponse {
    auth_url: string
    state: string
}


// OAuth2 Account Integration
export interface OAuth2AccountInfo {
    email: string
    name?: string
    provider: OAuth2ProviderType
    access_token: string
    refresh_token: string
    expires_at: number
}

// V2 Trigger Types
export type TriggerExpressionType = 'group' | 'condition' | 'plugin' | 'expression';
export type TriggerOperator = 'and' | 'or' | 'not' | 'equals' | 'contains' | 'startswith' | 'endswith' | 'matches' | 'in' | 'notin' | 'greater_than' | 'less_than';

// Expression engine types
export type ExpressionEngineType = 'expr.javascript' | 'expr.cel' | 'expr.go-template' | 'expr.jsonpath';

export interface TriggerExpression {
    id: string;
    type: TriggerExpressionType;
    operator?: string;
    field?: string;
    value?: any;
    conditions?: TriggerExpression[];
    not?: boolean;
    // For plugin and expression types
    pluginId?: string;
    fields?: Record<string, any>;
}

export interface TriggerActionV2 {
    id: string;
    pluginId: string;
    pluginName: string;
    config: Record<string, any>;
    enabled: boolean;
    executionOrder: number;
}

export interface EmailTriggerV2 {
    id: number;
    name: string;
    description?: string;
    enabled: boolean;
    expressions: TriggerExpression[];
    actions: TriggerActionV2[];
    totalExecutions: number;
    successExecutions: number;
    lastExecutedAt?: string;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
}

export interface CreateTriggerV2Request {
    name: string;
    description?: string;
    enabled: boolean;
    expressions: TriggerExpression[];
    actions: TriggerActionV2[];
}

export interface CreateOAuth2AccountRequest {
    email_address: string
    provider: OAuth2ProviderType
    access_token: string
    refresh_token: string
    expires_at: number
}

// ==================== Extractor Template V2 Types ====================

// 取件模板V2输出格式
export type ExtractorOutputFormat = 'text' | 'json' | 'array' | 'object';

// 输出配置
export interface ExtractorOutputConfig {
    format: ExtractorOutputFormat;
    field?: string;         // 从动作链输出中提取的字段名
    template?: string;      // 输出模板（用于格式化）
    description?: string;   // 输出字段描述
}

export interface ExtractorCompatibilityIssue {
    path: string;
    kind: string;
    pluginId?: string;
    pluginName?: string;
    message: string;
    severity: 'error' | 'warning' | string;
}

export interface ExtractorTemplateCompatibility {
    compatible: boolean;
    message?: string;
    issues?: ExtractorCompatibilityIssue[];
}

// 取件模板V2
export interface ExtractorTemplateV2 {
    id: number;
    name: string;
    description?: string;
    enabled: boolean;
    expressions: TriggerExpression[];       // 复用触发器表达式
    actions: TriggerActionV2[];             // 复用触发器动作
    outputConfig: ExtractorOutputConfig;
    category?: string;
    tags?: string[];
    totalExtractions: number;
    successExtractions: number;
    lastExtractedAt?: string;
    lastError?: string;
    createdAt: string;
    updatedAt: string;
    compatibility?: ExtractorTemplateCompatibility;
}

// 创建取件模板V2请求
export interface CreateExtractorTemplateV2Request {
    name: string;
    description?: string;
    enabled: boolean;
    expressions: TriggerExpression[];
    actions: TriggerActionV2[];
    outputConfig: ExtractorOutputConfig;
    category?: string;
    tags?: string[];
}

// 更新取件模板V2请求
export interface UpdateExtractorTemplateV2Request {
    name?: string;
    description?: string;
    enabled?: boolean;
    expressions?: TriggerExpression[];
    actions?: TriggerActionV2[];
    outputConfig?: ExtractorOutputConfig;
    category?: string;
    tags?: string[];
}

// 测试取件模板V2请求
export interface TestExtractorV2Request {
    expressions: TriggerExpression[];
    actions: TriggerActionV2[];
    outputConfig: ExtractorOutputConfig;
    emailId?: number;
    customEmail?: {
        from: string;
        to: string;
        cc?: string;
        subject: string;
        body: string;
        htmlBody?: string;
        headers?: Record<string, string>;
    };
}

// 动作执行结果
export interface ActionExecutionResult {
    actionId: string;
    pluginId: string;
    pluginName: string;
    success: boolean;
    startTime: string;
    endTime: string;
    duration: number;
    input?: Record<string, any>;
    output?: Record<string, any>;
    result?: any;
    error?: string;
}

// 提取执行状态
export type ExtractionV2Status = 'success' | 'failed' | 'no_match' | 'partial' | 'skipped';

// 提取结果
export interface ExtractionResult {
    success: boolean;
    status: ExtractionV2Status;
    filterMatched: boolean;
    extractedValue?: any;
    actionResults?: ActionExecutionResult[];
    executionTrace?: ExecutionTrace;
    duration: number;
    error?: string;
}

// 调试提取结果
export interface DebugExtractionResult extends ExtractionResult {
    filterEvaluation?: Record<string, any>;
    stepResults?: StepDebugResult[];
}

// 单步调试结果
export interface StepDebugResult {
    stepIndex: number;
    stepType: 'filter' | 'action';
    stepName: string;
    input?: Record<string, any>;
    output?: Record<string, any>;
    success: boolean;
    duration: number;
    error?: string;
}

// 提取日志V2
export interface ExtractionLogV2 {
    id: number;
    templateId: number;
    templateName: string;
    emailId: number;
    status: ExtractionV2Status;
    startTime: string;
    endTime: string;
    duration: number;
    filterMatched: boolean;
    filterEvaluation?: string;
    extractedResult?: string;
    actionResults?: ActionExecutionResult[];
    error?: string;
    executionTraceData?: string;
    createdAt: string;
}

// 分页响应
export interface PaginatedExtractorTemplateV2Response {
    templates: ExtractorTemplateV2[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface PaginatedExtractionLogV2Response {
    logs: ExtractionLogV2[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// ==================== Tag System Types ====================

// 标签组选择类型
export type TagGroupSelectionType = 'single' | 'multiple';

// 标签组
export interface TagGroup {
    id: number;
    name: string;
    description?: string;
    selectionType: TagGroupSelectionType;
    color?: string;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
}

// 标签
export interface Tag {
    id: number;
    groupId: number;
    name: string;
    color?: string;
    sortOrder: number;
    group?: TagGroup;  // 预加载的标签组
    createdAt: string;
    updatedAt: string;
}

// 简化的标签信息（用于列表）
export interface TagSimple {
    id: number;
    groupId: number;
    name: string;
    color?: string;
    sortOrder: number;
}

// 带标签组信息的标签
export interface TagWithGroup {
    id: number;
    groupId: number;
    groupName: string;
    name: string;
    color?: string;
}

// 带标签的标签组
export interface TagGroupWithTags {
    id: number;
    name: string;
    description?: string;
    selectionType: TagGroupSelectionType;
    color?: string;
    sortOrder: number;
    tags: TagSimple[];
    createdAt: string;
    updatedAt: string;
}

// 创建标签组请求
export interface CreateTagGroupRequest {
    name: string;
    description?: string;
    selectionType?: TagGroupSelectionType;
    color?: string;
    sortOrder?: number;
}

// 更新标签组请求
export interface UpdateTagGroupRequest {
    name?: string;
    description?: string;
    selectionType?: TagGroupSelectionType;
    color?: string;
    sortOrder?: number;
}

// 创建标签请求
export interface CreateTagRequest {
    groupId: number;
    name: string;
    color?: string;
    sortOrder?: number;
}

// 更新标签请求
export interface UpdateTagRequest {
    name?: string;
    color?: string;
    sortOrder?: number;
}

// 设置账户标签请求
export interface SetAccountTagsRequest {
    tagIds: number[];
}

// 批量账户标签操作请求
export interface BatchAccountTagsRequest {
    accountIds: number[];
    tagIds: number[];
}

// 批量添加/移除单个标签请求
export interface BatchAddRemoveTagRequest {
    accountIds: number[];
    tagId: number;
}

// 标签使用统计
export type TagUsageStats = Record<number, number>;
