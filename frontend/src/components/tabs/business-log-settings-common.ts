import { BusinessLogConfig, BusinessLogModuleConfig, BusinessLogScopeConfig } from '@/services/logging.service'

export const BUSINESS_LOG_MODULES = ['sync', 'pickup', 'trigger', 'email_account', 'business', 'proxy', 'wiki', 'oauth2', 'system_config', 'api']
export const BUSINESS_LOG_GENERAL_KEY = '__general__'

export const BUSINESS_LOG_MODULE_META: Record<string, { name: string; description: string }> = {
    sync: { name: '邮箱同步', description: '自动/手动同步、拉取结果、同步异常' },
    pickup: { name: '取件轮询', description: '业务取件、提取结果、命中情况' },
    trigger: { name: '触发器', description: '触发执行、条件命中、动作结果' },
    email_account: { name: '邮箱账户', description: '账号配置、状态变化、授权相关' },
    business: { name: '业务对象', description: '业务模块、业务账户、流程动作' },
    proxy: { name: '代理', description: '代理请求、通道状态、调用耗时' },
    wiki: { name: 'Wiki', description: '页面、表格、公式和内容变更' },
    oauth2: { name: 'OAuth2', description: '授权会话、服务商、令牌刷新' },
    system_config: { name: '系统配置', description: '配置项变更和审计' },
    api: { name: 'API', description: '接口调用、来源、响应状态' },
}

export function getBusinessLogModuleMeta(module: string) {
    return BUSINESS_LOG_MODULE_META[module] || { name: module, description: '业务日志模块' }
}

export function defaultBusinessLogConfig(): BusinessLogConfig {
    return {
        enabled: true,
        redactSensitive: true,
        detailLevel: 'summary',
        forceRecordFailures: true,
        successSampleRate: 1,
        retentionDays: 0,
        globalLimit: 0,
        moduleLimits: {},
        modules: {},
        organizationConfigs: {},
        sensitiveFields: ['authorization', 'cookie', 'password', 'passwd', 'secret', 'token', 'refresh_token', 'access_token', 'api_key', 'apikey', 'credential', 'proxy', 'private_key', 'totp', 'recovery_code'],
        reviewMiddlewareMode: 'disabled',
    }
}

export function withBusinessLogDefaults(config?: Partial<BusinessLogConfig>): BusinessLogConfig {
    const defaults = defaultBusinessLogConfig()
    return {
        ...defaults,
        ...config,
        moduleLimits: config?.moduleLimits || {},
        modules: config?.modules || {},
        organizationConfigs: config?.organizationConfigs || {},
        sensitiveFields: config?.sensitiveFields || defaults.sensitiveFields,
    }
}

export function parseCsv(value: string): string[] {
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
}

export function joinCsv(value?: string[]): string {
    return (value || []).join(', ')
}

export function clampRate(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(1, value))
}

export function clampInt(value: number): number {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.round(value))
}

export function boolToSelect(value?: boolean): string {
    if (value === undefined) return 'inherit'
    return value ? 'enabled' : 'disabled'
}

export function selectToBool(value: string): boolean | undefined {
    if (value === 'inherit') return undefined
    return value === 'enabled'
}

export function cleanModuleConfig(config: BusinessLogModuleConfig): BusinessLogModuleConfig {
    const next: BusinessLogModuleConfig = { ...config }
    if (next.enabled === undefined) delete next.enabled
    if (next.redactSensitive === undefined) delete next.redactSensitive
    if (next.mergeEnabled === undefined) delete next.mergeEnabled
    if (next.successSampleRate === undefined) delete next.successSampleRate
    if (!next.detailLevel) delete next.detailLevel
    if (!next.recordActions?.length) delete next.recordActions
    if (!next.ignoreActions?.length) delete next.ignoreActions
    if (!next.limit) delete next.limit
    if (!next.mergeWindowSeconds) delete next.mergeWindowSeconds
    return next
}

export function emptyBusinessLogScope(): BusinessLogScopeConfig {
    return {
        moduleLimits: {},
        modules: {},
    }
}

export interface BusinessLogModuleEffectiveConfig {
    enabled: boolean
    redactSensitive: boolean
    detailLevel: string
    successSampleRate: number
    limit: number
    recordActions: string[]
    ignoreActions: string[]
    mergeEnabled: boolean
    mergeWindowSeconds: number
}

export function resolveBusinessLogModuleEffectiveConfig(
    config: BusinessLogConfig,
    module: string,
    scope?: BusinessLogScopeConfig,
): BusinessLogModuleEffectiveConfig {
    const defaults = defaultBusinessLogConfig()
    const globalModule = config.modules?.[module] || {}
    const scopeModule = scope?.modules?.[module] || {}

    const topLevelEnabled = scope?.enabled ?? config.enabled ?? defaults.enabled
    const moduleEnabled = scopeModule.enabled ?? globalModule.enabled ?? true
    const topLevelRedact = scope?.redactSensitive ?? config.redactSensitive ?? defaults.redactSensitive
    const topLevelDetailLevel = scope?.detailLevel || config.detailLevel || defaults.detailLevel
    const topLevelSampleRate = scope?.successSampleRate ?? config.successSampleRate ?? defaults.successSampleRate
    const moduleLimit = scopeModule.limit || globalModule.limit || scope?.moduleLimits?.[module] || config.moduleLimits?.[module] || 0
    const globalLimit = scope?.globalLimit ?? config.globalLimit ?? 0
    const effectiveLimit = globalLimit > 0 && (moduleLimit === 0 || globalLimit < moduleLimit) ? globalLimit : moduleLimit

    return {
        enabled: Boolean(topLevelEnabled && moduleEnabled),
        redactSensitive: scopeModule.redactSensitive ?? globalModule.redactSensitive ?? topLevelRedact,
        detailLevel: scopeModule.detailLevel || globalModule.detailLevel || topLevelDetailLevel,
        successSampleRate: scopeModule.successSampleRate ?? globalModule.successSampleRate ?? topLevelSampleRate,
        limit: effectiveLimit,
        recordActions: scopeModule.recordActions ?? globalModule.recordActions ?? [],
        ignoreActions: scopeModule.ignoreActions ?? globalModule.ignoreActions ?? [],
        mergeEnabled: scopeModule.mergeEnabled ?? globalModule.mergeEnabled ?? false,
        mergeWindowSeconds: scopeModule.mergeWindowSeconds || globalModule.mergeWindowSeconds || 60,
    }
}
