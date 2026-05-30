import { apiClient } from '@/lib/api-client'
import type { AccountNoteFormat, EmailAccount } from '@/types'

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
    sortOrder?: number
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

    async listAccounts(params?: BusinessAccountListParams): Promise<BusinessAccountsListResponse> {
        return apiClient.get<BusinessAccountsListResponse>('/business-accounts', { params })
    }

    async createAccount(payload: BusinessAccountPayload): Promise<BusinessAccount> {
        return apiClient.post<BusinessAccount>('/business-accounts', payload)
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
