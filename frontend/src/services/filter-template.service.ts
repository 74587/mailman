import { apiClient } from '@/lib/api-client'

// 过滤器模板接口
export interface FilterTemplate {
    id: number
    name: string
    description?: string
    category?: string
    tags?: string[]
    expressions: any[]
    usageCount: number
    isBuiltin: boolean
    createdAt: string
    updatedAt?: string
}

// 过滤器模板列表项
export interface FilterTemplateListItem {
    id: number
    name: string
    description?: string
    category?: string
    tags?: string[]
    usageCount: number
    isBuiltin: boolean
    createdAt: string
}

// 创建/更新请求
export interface FilterTemplateRequest {
    name: string
    description?: string
    category?: string
    tags?: string[]
    expressions: any[]
}

// 列表响应
export interface FilterTemplateListResponse {
    items: FilterTemplateListItem[]
    total: number
    page: number
    pageSize: number
}

// 分类响应
export interface FilterTemplateCategoriesResponse {
    categories: string[]
}

class FilterTemplateService {
    /**
     * 获取过滤器模板列表
     */
    async list(params?: {
        page?: number
        pageSize?: number
        category?: string
        search?: string
    }): Promise<FilterTemplateListResponse> {
        const queryParams = new URLSearchParams()
        if (params?.page) queryParams.set('page', params.page.toString())
        if (params?.pageSize) queryParams.set('pageSize', params.pageSize.toString())
        if (params?.category) queryParams.set('category', params.category)
        if (params?.search) queryParams.set('search', params.search)

        const query = queryParams.toString()
        return apiClient.get<FilterTemplateListResponse>(
            `/filter-templates${query ? `?${query}` : ''}`
        )
    }

    /**
     * 获取单个过滤器模板详情
     */
    async get(id: number): Promise<FilterTemplate> {
        return apiClient.get<FilterTemplate>(`/filter-templates/${id}`)
    }

    /**
     * 创建过滤器模板
     */
    async create(data: FilterTemplateRequest): Promise<FilterTemplate> {
        return apiClient.post<FilterTemplate>('/filter-templates', data)
    }

    /**
     * 更新过滤器模板
     */
    async update(id: number, data: FilterTemplateRequest): Promise<FilterTemplate> {
        return apiClient.put<FilterTemplate>(`/filter-templates/${id}`, data)
    }

    /**
     * 删除过滤器模板
     */
    async delete(id: number): Promise<void> {
        return apiClient.delete(`/filter-templates/${id}`)
    }

    /**
     * 增加使用次数
     */
    async incrementUsage(id: number): Promise<void> {
        return apiClient.post(`/filter-templates/${id}/increment-usage`, {})
    }

    /**
     * 获取所有分类
     */
    async getCategories(): Promise<string[]> {
        const response = await apiClient.get<FilterTemplateCategoriesResponse>(
            '/filter-templates/categories'
        )
        return response.categories || []
    }
}

export const filterTemplateService = new FilterTemplateService()
