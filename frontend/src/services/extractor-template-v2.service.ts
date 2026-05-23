import { apiClient } from '@/lib/api-client'
import type {
    ExtractorTemplateV2,
    CreateExtractorTemplateV2Request,
    UpdateExtractorTemplateV2Request,
    PaginatedExtractorTemplateV2Response,
    TestExtractorV2Request,
    ExtractionResult,
    DebugExtractionResult,
    ExtractionLogV2,
    PaginatedExtractionLogV2Response,
} from '@/types'

export const extractorTemplateV2Service = {
    // 获取取件模板列表
    async getTemplates(): Promise<ExtractorTemplateV2[]> {
        const response = await apiClient.get<ExtractorTemplateV2[]>('/v2/extractor-templates')
        return response || []
    },

    // 获取取件模板列表（分页）
    async getTemplatesPaginated(
        page: number = 1,
        limit: number = 10,
        options?: {
            search?: string
            category?: string
            enabled?: boolean
        }
    ): Promise<PaginatedExtractorTemplateV2Response> {
        let url = `/v2/extractor-templates/paginated?page=${page}&limit=${limit}`
        if (options?.search) {
            url += `&search=${encodeURIComponent(options.search)}`
        }
        if (options?.category) {
            url += `&category=${encodeURIComponent(options.category)}`
        }
        if (options?.enabled !== undefined) {
            url += `&enabled=${options.enabled}`
        }
        const response = await apiClient.get<PaginatedExtractorTemplateV2Response>(url)
        return response
    },

    // 获取单个取件模板
    async getTemplate(id: number): Promise<ExtractorTemplateV2> {
        const response = await apiClient.get<ExtractorTemplateV2>(`/v2/extractor-templates/${id}`)
        return response
    },

    // 创建取件模板
    async createTemplate(data: CreateExtractorTemplateV2Request): Promise<ExtractorTemplateV2> {
        const response = await apiClient.post<ExtractorTemplateV2>('/v2/extractor-templates', data)
        return response
    },

    // 更新取件模板
    async updateTemplate(id: number, data: UpdateExtractorTemplateV2Request): Promise<ExtractorTemplateV2> {
        const response = await apiClient.put<ExtractorTemplateV2>(`/v2/extractor-templates/${id}`, data)
        return response
    },

    // 删除取件模板
    async deleteTemplate(id: number): Promise<void> {
        await apiClient.delete(`/v2/extractor-templates/${id}`)
    },

    // 测试取件模板
    async testTemplate(data: TestExtractorV2Request): Promise<ExtractionResult> {
        const response = await apiClient.post<ExtractionResult>('/v2/extractor-templates/test', data)
        return response
    },

    // 调试取件模板
    async debugTemplate(data: TestExtractorV2Request & { stepByStep?: boolean }): Promise<DebugExtractionResult> {
        const response = await apiClient.post<DebugExtractionResult>('/v2/extractor-templates/debug', data)
        return response
    },

    // 执行取件模板
    async executeTemplate(id: number, emailId: number): Promise<ExtractionResult> {
        const response = await apiClient.post<ExtractionResult>(`/v2/extractor-templates/${id}/execute`, {
            emailId,
        })
        return response
    },

    // 获取取件日志
    async getTemplateLogs(
        templateId: number,
        page: number = 1,
        limit: number = 20
    ): Promise<PaginatedExtractionLogV2Response> {
        const response = await apiClient.get<PaginatedExtractionLogV2Response>(
            `/v2/extractor-templates/${templateId}/logs?page=${page}&limit=${limit}`
        )
        return response
    },

    // 获取统计数据
    async getTemplateStats(templateId: number): Promise<Record<string, number>> {
        const response = await apiClient.get<Record<string, number>>(
            `/v2/extractor-templates/${templateId}/stats`
        )
        return response
    },

    // 获取所有分类
    async getCategories(): Promise<string[]> {
        const response = await apiClient.get<string[]>('/v2/extractor-templates/categories')
        return response || []
    },

    // 查找匹配邮件的模板
    async findMatchingTemplates(emailId: number): Promise<ExtractorTemplateV2[]> {
        const response = await apiClient.get<ExtractorTemplateV2[]>(
            `/v2/extractor-templates/match?emailId=${emailId}`
        )
        return response || []
    },
}
