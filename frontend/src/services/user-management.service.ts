import { apiClient } from '@/lib/api-client';

// 管理用户类型
export interface ManagedUser {
    id: number;
    username: string;
    email: string;
    avatar?: string;
    is_super_admin: boolean;
    is_active: boolean;
    current_org_id?: number;
    last_login_at?: string;
    created_at: string;
    updated_at: string;
}

export interface CreateUserRequest {
    username: string;
    email: string;
    password: string;
    orgId?: number;
    roleId?: number;
}

export interface AdminUpdateUserRequest {
    username?: string;
    email?: string;
    password?: string;
    isActive?: boolean;
    isSuperAdmin?: boolean;
}

export interface UserListResponse {
    data: ManagedUser[];
    total: number;
    page: number;
    limit: number;
}

class UserManagementService {
    // 列出所有用户（仅超管）
    async listUsers(page: number = 1, limit: number = 50): Promise<UserListResponse> {
        return apiClient.get<UserListResponse>(`/admin/users?page=${page}&limit=${limit}`);
    }

    // 创建用户（仅超管）
    async createUser(data: CreateUserRequest): Promise<ManagedUser> {
        return apiClient.post<ManagedUser>('/admin/users', data);
    }

    // 获取单个用户详情
    async getUser(id: number): Promise<ManagedUser> {
        return apiClient.get<ManagedUser>(`/admin/users/${id}`);
    }

    // 更新用户（仅超管）
    async updateUser(id: number, data: AdminUpdateUserRequest): Promise<ManagedUser> {
        return apiClient.put<ManagedUser>(`/admin/users/${id}`, data);
    }

    // 禁用用户（仅超管）
    async deleteUser(id: number): Promise<void> {
        return apiClient.delete(`/admin/users/${id}`);
    }
}

export const userManagementService = new UserManagementService();
