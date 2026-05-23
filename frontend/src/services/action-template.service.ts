import { apiClient } from '@/lib/api-client'

// 动作模板接口
export interface ActionTemplate {
    id: number
    name: string
    description?: string
    category?: string
    tags?: string[]
    actions: ActionConfig[]
    usageCount: number
    isBuiltin: boolean
    createdAt: string
    updatedAt?: string
}

// 动作配置接口
export interface ActionConfig {
    id?: string
    pluginId: string
    pluginName?: string
    config: Record<string, any>
    enabled?: boolean
    executionOrder?: number
}

// 动作模板列表项
export interface ActionTemplateListItem {
    id: number
    name: string
    description?: string
    category?: string
    tags?: string[]
    actionCount: number
    usageCount: number
    isBuiltin: boolean
    createdAt: string
}

// 创建/更新请求
export interface ActionTemplateRequest {
    name: string
    description?: string
    category?: string
    tags?: string[]
    actions: ActionConfig[]
}

// 列表响应
export interface ActionTemplateListResponse {
    items: ActionTemplateListItem[]
    total: number
    page: number
    pageSize: number
}

// 分类响应
export interface ActionTemplateCategoriesResponse {
    categories: string[]
}

class ActionTemplateService {
    /**
     * 获取动作模板列表
     */
    async list(params?: {
        page?: number
        pageSize?: number
        category?: string
        search?: string
    }): Promise<ActionTemplateListResponse> {
        const queryParams = new URLSearchParams()
        if (params?.page) queryParams.set('page', params.page.toString())
        if (params?.pageSize) queryParams.set('pageSize', params.pageSize.toString())
        if (params?.category) queryParams.set('category', params.category)
        if (params?.search) queryParams.set('search', params.search)

        const query = queryParams.toString()
        return apiClient.get<ActionTemplateListResponse>(
            `/action-templates${query ? `?${query}` : ''}`
        )
    }

    /**
     * 获取单个动作模板详情
     */
    async get(id: number): Promise<ActionTemplate> {
        return apiClient.get<ActionTemplate>(`/action-templates/${id}`)
    }

    /**
     * 创建动作模板
     */
    async create(data: ActionTemplateRequest): Promise<ActionTemplate> {
        return apiClient.post<ActionTemplate>('/action-templates', data)
    }

    /**
     * 更新动作模板
     */
    async update(id: number, data: ActionTemplateRequest): Promise<ActionTemplate> {
        return apiClient.put<ActionTemplate>(`/action-templates/${id}`, data)
    }

    /**
     * 删除动作模板
     */
    async delete(id: number): Promise<void> {
        return apiClient.delete(`/action-templates/${id}`)
    }

    /**
     * 增加使用次数
     */
    async incrementUsage(id: number): Promise<void> {
        return apiClient.post(`/action-templates/${id}/increment-usage`, {})
    }

    /**
     * 获取所有分类
     */
    async getCategories(): Promise<string[]> {
        const response = await apiClient.get<ActionTemplateCategoriesResponse>(
            '/action-templates/categories'
        )
        return response.categories || []
    }
}

export const actionTemplateService = new ActionTemplateService()
