import { apiClient } from '@/lib/api-client';
import {
    TagGroup,
    TagGroupWithTags,
    Tag,
    TagWithGroup,
    CreateTagGroupRequest,
    UpdateTagGroupRequest,
    CreateTagRequest,
    UpdateTagRequest,
    SetAccountTagsRequest,
    BatchAccountTagsRequest,
    BatchAddRemoveTagRequest,
    TagUsageStats,
} from '@/types';

export class TagService {
    private basePath = '';

    // 缓存 tag groups 避免重复请求
    private tagGroupsCache: TagGroupWithTags[] | null = null;
    private tagGroupsCacheTime: number = 0;
    private readonly CACHE_TTL = 30000; // 30秒缓存

    // ======================== TagGroup API ========================

    /**
     * 获取所有标签组（包含标签）- 带缓存
     */
    async getTagGroups(forceRefresh = false): Promise<TagGroupWithTags[]> {
        const now = Date.now();

        // 如果缓存有效且不强制刷新，返回缓存
        if (!forceRefresh && this.tagGroupsCache && (now - this.tagGroupsCacheTime < this.CACHE_TTL)) {
            return this.tagGroupsCache;
        }

        const response = await apiClient.get<TagGroupWithTags[]>('/tag-groups');
        this.tagGroupsCache = response;
        this.tagGroupsCacheTime = now;
        return response;
    }

    /**
     * 清除标签组缓存
     */
    clearTagGroupsCache() {
        this.tagGroupsCache = null;
        this.tagGroupsCacheTime = 0;
    }

    /**
     * 获取单个标签组
     */
    async getTagGroup(id: number): Promise<TagGroupWithTags> {
        const response = await apiClient.get<TagGroupWithTags>(`/tag-groups/${id}`);
        return response;
    }

    /**
     * 创建标签组
     */
    async createTagGroup(data: CreateTagGroupRequest): Promise<TagGroupWithTags> {
        const response = await apiClient.post<TagGroupWithTags>('/tag-groups', data);
        this.clearTagGroupsCache(); // 清除缓存以便下次获取最新数据
        return response;
    }

    /**
     * 更新标签组
     */
    async updateTagGroup(id: number, data: UpdateTagGroupRequest): Promise<TagGroupWithTags> {
        const response = await apiClient.put<TagGroupWithTags>(`/tag-groups/${id}`, data);
        this.clearTagGroupsCache();
        return response;
    }

    /**
     * 删除标签组
     */
    async deleteTagGroup(id: number): Promise<void> {
        await apiClient.delete(`/tag-groups/${id}`);
        this.clearTagGroupsCache();
    }

    // ======================== Tag API ========================

    /**
     * 获取所有标签
     */
    async getTags(): Promise<TagWithGroup[]> {
        const response = await apiClient.get<TagWithGroup[]>('/tags');
        return response;
    }

    /**
     * 创建标签
     */
    async createTag(data: CreateTagRequest): Promise<Tag> {
        const response = await apiClient.post<Tag>('/tags', data);
        this.clearTagGroupsCache(); // 标签变化也需要清除标签组缓存
        return response;
    }

    /**
     * 更新标签
     */
    async updateTag(id: number, data: UpdateTagRequest): Promise<Tag> {
        const response = await apiClient.put<Tag>(`/tags/${id}`, data);
        this.clearTagGroupsCache();
        return response;
    }

    /**
     * 删除标签
     */
    async deleteTag(id: number): Promise<void> {
        await apiClient.delete(`/tags/${id}`);
        this.clearTagGroupsCache();
    }

    /**
     * 获取标签使用统计
     */
    async getTagUsageStats(): Promise<TagUsageStats> {
        const response = await apiClient.get<TagUsageStats>('/tags/usage');
        return response;
    }

    // ======================== Account-Tag API ========================

    /**
     * 获取账户的标签
     */
    async getAccountTags(accountId: number): Promise<TagWithGroup[]> {
        const response = await apiClient.get<TagWithGroup[]>(`/accounts/${accountId}/tags`);
        return response;
    }

    /**
     * 设置账户的标签（替换所有现有标签）
     */
    async setAccountTags(accountId: number, tagIds: number[]): Promise<TagWithGroup[]> {
        const response = await apiClient.put<TagWithGroup[]>(
            `/accounts/${accountId}/tags`,
            { tagIds } as SetAccountTagsRequest
        );
        return response;
    }

    /**
     * 批量设置账户标签
     */
    async batchSetAccountTags(accountIds: number[], tagIds: number[]): Promise<{ message: string; count: number }> {
        const response = await apiClient.post<{ message: string; count: number }>(
            '/accounts/batch-tags',
            { accountIds, tagIds } as BatchAccountTagsRequest
        );
        return response;
    }

    /**
     * 批量添加标签
     */
    async batchAddTag(accountIds: number[], tagId: number): Promise<{ message: string; count: number }> {
        const response = await apiClient.post<{ message: string; count: number }>(
            '/accounts/batch-add-tag',
            { accountIds, tagId } as BatchAddRemoveTagRequest
        );
        return response;
    }

    /**
     * 批量移除标签
     */
    async batchRemoveTag(accountIds: number[], tagId: number): Promise<{ message: string; count: number }> {
        const response = await apiClient.post<{ message: string; count: number }>(
            '/accounts/batch-remove-tag',
            { accountIds, tagId } as BatchAddRemoveTagRequest
        );
        return response;
    }
}

// 导出单例实例
export const tagService = new TagService();
