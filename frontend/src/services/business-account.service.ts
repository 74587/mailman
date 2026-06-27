import { apiClient } from '@/lib/api-client'
import type { AccountNoteFormat, EmailAccount } from '@/types'
import type { PickupPollResponse } from '@/services/pickup.service'

export type BusinessAccountStatus = string
export type BusinessCustomFieldType = 'text' | 'username' | 'password' | 'totp' | 'url' | 'email' | 'phone' | 'date' | 'number' | 'note'

export interface BusinessStatusOption {
    value: string
    label: string
    color?: string
}

export interface BusinessCustomFieldValue {
    type?: BusinessCustomFieldType
    value?: string
    label?: string
}

export interface BusinessModule {
    id: number
    orgId?: number
    name: string
    website?: string
    loginUrl?: string
    description?: string
    icon?: string
    logo?: string
    color?: string
    fieldSchema?: Record<string, any>
    statusOptions?: Record<string, any>
    claimDefaults?: BusinessClaimDefaults
    emailConstraints?: BusinessEmailConstraints
    sortOrder?: number
    createdAt?: string
    updatedAt?: string
}

export interface BusinessAccount {
    id: number
    orgId?: number
    emailAccountId?: number
    emailAccount?: EmailAccount
    moduleId?: number
    module?: BusinessModule
    moduleName?: string
    displayName?: string
    website?: string
    loginUrl?: string
    username?: string
    password?: string
    totpSecret?: string
    phoneNumber?: string
    recoveryEmail?: string
    recoveryCodes?: string[]
    status: BusinessAccountStatus
    description?: string
    note?: string
    noteFormat?: AccountNoteFormat | string
    tags?: string[]
    customFields?: Record<string, string | BusinessCustomFieldValue>
    extraData?: Record<string, any>
    registrationEmail?: string
    claimToken?: string
    claimExpiresAt?: string
    claimedBy?: string
    remoteCreatedAt?: string
    lastLoginAt?: string
    createdAt?: string
    updatedAt?: string
}

export interface BusinessAccountsListResponse {
    data: BusinessAccount[]
    total: number
    page: number
    limit: number
    totalPages: number
}

export interface BusinessModulesListResponse {
    data: BusinessModule[]
    total: number
    page: number
    limit: number
    totalPages: number
}

export interface BusinessAccountListParams {
    page?: number
    limit?: number
    search?: string
    status?: BusinessAccountStatus | ''
    moduleId?: number
    emailAccountId?: number
    emailLinked?: boolean | ''
    registrationEmailSuffix?: string
}

export interface BusinessAccountPayload {
    emailAccountId?: number
    moduleId?: number
    moduleName?: string
    displayName?: string
    website?: string
    loginUrl?: string
    username?: string
    password?: string
    totpSecret?: string
    phoneNumber?: string
    recoveryEmail?: string
    recoveryCodes?: string[]
    status?: BusinessAccountStatus
    description?: string
    note?: string
    noteFormat?: AccountNoteFormat
    tags?: string[]
    customFields?: Record<string, string | BusinessCustomFieldValue>
    extraData?: Record<string, any>
    remoteCreatedAt?: string
    lastLoginAt?: string
}

export interface BusinessEmailClaimPayload {
    ttlSeconds?: number
    claimedBy?: string
    accountId?: number
    aliasBaseAccountId?: number
    emailAddress?: string
    emailSuffix?: string
    emailSuffixes?: string[]
    emailSuffixPriorityEnabled?: boolean
    blockedEmailSuffixes?: string[]
    emailMode?: 'auto' | 'primary' | 'domain' | 'alias' | 'forwarded'
    emailModePriorityEnabled?: boolean
    emailModePriority?: Array<'primary' | 'domain' | 'alias' | 'forwarded'>
    useDomainMail?: boolean
    domain?: string
    useAlias?: boolean
    aliasType?: 'gmail_plus' | 'domain_local_part' | 'forwarded'
    aliasLocalPart?: string
    prefixStrategy?: 'literal' | 'builtin' | 'template' | 'random'
    prefix?: string
    prefixTemplate?: string
    builtinPrefix?: string
    randomLength?: number
    tagIds?: number[]
    tagFilterMode?: 'or' | 'and'
    providerId?: number
    authTypes?: string[]
    proxyMode?: string
    businessAccount?: Partial<BusinessAccountPayload>
}

export interface BusinessEmailClaimResponse {
    businessAccountId: number
    claimToken: string
    claimExpiresAt: string
    ttlSeconds: number
    module: { id: number; name: string }
    emailAccount: {
        id: number
        emailAddress: string
        authType: string
        isDomainMail: boolean
        domain?: string
        mailProviderId?: number
        proxyMode?: string
        proxyId?: number
        isVerified?: boolean
        errorStatus?: string
    }
    recipient: {
        emailAddress: string
        kind: string
        toQuery: string
        resolvedBy: string
        domain?: string
        localPart?: string
    }
    pickup: {
        account_id: number
        to_query: string
    }
    businessAccount: {
        id: number
        status: string
        emailAccountId?: number
        moduleId?: number
        registrationEmail?: string
    }
}

export interface BusinessModulePayload {
    name: string
    website?: string
    loginUrl?: string
    description?: string
    icon?: string
    logo?: string
    color?: string
    fieldSchema?: Record<string, any>
    statusOptions?: Record<string, any>
    claimDefaults?: BusinessClaimDefaults
    emailConstraints?: BusinessEmailConstraints
    sortOrder?: number
}

export interface BusinessClaimDefaults {
    ttlSeconds?: number
    emailMode?: 'auto' | 'primary' | 'domain' | 'alias' | 'forwarded'
    emailModePriorityEnabled?: boolean
    emailModePriority?: Array<'primary' | 'domain' | 'alias' | 'forwarded'>
    emailModeOrder?: Array<'primary' | 'domain' | 'alias' | 'forwarded'>
    emailModeSortEnabled?: boolean
    enableEmailModePriority?: boolean
    emailSuffix?: string
    emailSuffixes?: string[]
    blockedEmailSuffixes?: string[]
    useDomainMail?: boolean
    domain?: string
    useAlias?: boolean
    aliasType?: 'gmail_plus' | 'domain_local_part' | 'forwarded'
    prefixStrategy?: 'literal' | 'builtin' | 'template' | 'random'
    prefix?: string
    prefixTemplate?: string
    builtinPrefix?: string
    randomLength?: number
    tagIds?: number[]
    tagFilterMode?: 'or' | 'and'
    providerId?: number
    authTypes?: string[]
    proxyMode?: string
}

export interface BusinessEmailConstraints {
    allowedSuffixes?: string[]
    allowedSuffixPriorityEnabled?: boolean
    emailSuffixPriorityEnabled?: boolean
    suffixPriorityEnabled?: boolean
    blockedSuffixes?: string[]
    allowedDomains?: string[]
    blockedDomains?: string[]
    allowAliases?: boolean
    allowDomainMail?: boolean
    allowForwarded?: boolean
}

export interface BusinessScenario {
    id: number
    orgId?: number
    moduleId: number
    key: string
    name: string
    description?: string
    enabled: boolean
    pickupConfig?: Record<string, any>
    extractorConfig?: Record<string, any>
    sortOrder?: number
    createdAt?: string
    updatedAt?: string
}

export interface BusinessScenarioPayload {
    key?: string
    name: string
    description?: string
    enabled?: boolean
    pickupConfig?: Record<string, any>
    extractorConfig?: Record<string, any>
    sortOrder?: number
}

export interface CompleteBusinessRegistrationPayload {
    claimToken: string
    username?: string
    password?: string
    totpSecret?: string
    phoneNumber?: string
    recoveryEmail?: string
    recoveryCodes?: string[]
    status?: BusinessAccountStatus
    description?: string
    note?: string
    noteFormat?: AccountNoteFormat
    tags?: string[]
    customFields?: Record<string, string | BusinessCustomFieldValue>
    extraData?: Record<string, any>
    remoteCreatedAt?: string
    lastLoginAt?: string
}

export interface BusinessEmailExclusionReleasePayload {
    type?: 'cooldown' | 'blacklist'
    scope?: 'module' | 'global'
    target?: 'email_account' | 'registration_email' | 'both'
    durationSeconds?: number
    reason?: string
    message?: string
    emailAccountId?: number
    registrationEmail?: string
}

export interface ReleaseBusinessRegistrationPayload {
    claimToken: string
    reason?: string
    message?: string
    deletePendingAccount?: boolean
    exclusion?: BusinessEmailExclusionReleasePayload
    exclusions?: BusinessEmailExclusionReleasePayload[]
}

export interface RenewBusinessRegistrationPayload {
    claimToken: string
    ttlSeconds?: number
    message?: string
}

export interface RenewBusinessRegistrationResponse {
    businessAccountId: number
    claimExpiresAt: string
    ttlSeconds: number
    status: BusinessAccountStatus
}

export interface BusinessScenarioPickupPayload {
    claimToken?: string
    keep_alive_seconds?: number
    keepAliveSeconds?: number
    sync_interval?: number
    syncInterval?: number
    limit?: number
    since?: string
    to_query?: string
    toQuery?: string
    template_id?: number
    templateId?: number
    inline_actions?: unknown
    inlineActions?: unknown
    simple_extract?: unknown
    simpleExtract?: unknown
}

export interface BusinessScenarioPickupResponse {
    businessAccount: {
        id: number
        status: BusinessAccountStatus
        emailAccountId?: number
        moduleId?: number
        registrationEmail?: string
    }
    scenario: BusinessScenario
    pickup: PickupPollResponse
}

class BusinessAccountService {
    async listModules(search?: string, params?: { page?: number; limit?: number }): Promise<BusinessModule[]> {
        const response = await apiClient.get<BusinessModule[] | BusinessModulesListResponse>('/business-modules', {
            params: { search, ...params },
        })
        return Array.isArray(response) ? response : response.data
    }

    async listModulesPage(params?: { page?: number; limit?: number; search?: string }): Promise<BusinessModulesListResponse> {
        return apiClient.get<BusinessModulesListResponse>('/business-modules', {
            params: { page: 1, limit: 50, ...params },
        })
    }

    async createModule(payload: BusinessModulePayload): Promise<BusinessModule> {
        return apiClient.post<BusinessModule>('/business-modules', payload)
    }

    async updateModule(id: number, payload: BusinessModulePayload): Promise<BusinessModule> {
        return apiClient.put<BusinessModule>(`/business-modules/${id}`, payload)
    }

    async deleteModule(id: number): Promise<void> {
        return apiClient.delete<void>(`/business-modules/${id}`)
    }

    async listScenarios(moduleId: number): Promise<BusinessScenario[]> {
        return apiClient.get<BusinessScenario[]>(`/business-modules/${moduleId}/scenarios`)
    }

    async createScenario(moduleId: number, payload: BusinessScenarioPayload): Promise<BusinessScenario> {
        return apiClient.post<BusinessScenario>(`/business-modules/${moduleId}/scenarios`, payload)
    }

    async updateScenario(moduleId: number, scenarioKey: string, payload: BusinessScenarioPayload): Promise<BusinessScenario> {
        return apiClient.put<BusinessScenario>(`/business-modules/${moduleId}/scenarios/${encodeURIComponent(scenarioKey)}`, payload)
    }

    async deleteScenario(moduleId: number, scenarioKey: string): Promise<void> {
        return apiClient.delete<void>(`/business-modules/${moduleId}/scenarios/${encodeURIComponent(scenarioKey)}`)
    }

    async listAccounts(params?: BusinessAccountListParams): Promise<BusinessAccountsListResponse> {
        return apiClient.get<BusinessAccountsListResponse>('/business-accounts', { params })
    }

    async createAccount(payload: BusinessAccountPayload): Promise<BusinessAccount> {
        return apiClient.post<BusinessAccount>('/business-accounts', payload)
    }

    async claimModuleEmailAccount(moduleId: number, payload: BusinessEmailClaimPayload = {}): Promise<BusinessEmailClaimResponse> {
        return apiClient.post<BusinessEmailClaimResponse>(`/business-modules/${moduleId}/email-accounts/claim`, payload)
    }

    async completeRegistration(id: number, payload: CompleteBusinessRegistrationPayload): Promise<BusinessAccount> {
        return apiClient.post<BusinessAccount>(`/business-accounts/${id}/complete-registration`, payload)
    }

    async releaseRegistrationClaim(id: number, payload: ReleaseBusinessRegistrationPayload): Promise<BusinessAccount | { businessAccountId: number; released: boolean; deleted?: boolean }> {
        return apiClient.post<BusinessAccount | { businessAccountId: number; released: boolean; deleted?: boolean }>(`/business-accounts/${id}/release-registration-claim`, payload)
    }

    async renewRegistrationClaim(id: number, payload: RenewBusinessRegistrationPayload): Promise<RenewBusinessRegistrationResponse> {
        return apiClient.post<RenewBusinessRegistrationResponse>(`/business-accounts/${id}/renew-registration-claim`, payload)
    }

    async pickupScenario(id: number, scenarioKey: string, payload: BusinessScenarioPickupPayload = {}): Promise<BusinessScenarioPickupResponse> {
        return apiClient.post<BusinessScenarioPickupResponse>(`/business-accounts/${id}/scenarios/${encodeURIComponent(scenarioKey)}/pickup`, payload)
    }

    async updateAccount(id: number, payload: BusinessAccountPayload): Promise<BusinessAccount> {
        return apiClient.put<BusinessAccount>(`/business-accounts/${id}`, payload)
    }

    async deleteAccount(id: number): Promise<void> {
        return apiClient.delete<void>(`/business-accounts/${id}`)
    }

    async listByEmailAccount(emailAccountId: number): Promise<BusinessAccount[]> {
        return apiClient.get<BusinessAccount[]>(`/accounts/${emailAccountId}/business-accounts`)
    }
}

export const businessAccountService = new BusinessAccountService()
