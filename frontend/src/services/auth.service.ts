import { apiClient } from '@/lib/api-client';

export interface LoginRequest {
    username: string;
    password: string;
}

export interface UpdateUserRequest {
    username?: string;
    email?: string;
    avatar?: string;
    old_password?: string;
    new_password?: string;
}

export interface LoginResponse {
    token: string;
    user: {
        id: number;
        username: string;
        email: string;
        avatar?: string;
        is_admin: boolean;
        is_super_admin: boolean;
        current_org_id?: number;
        created_at: string;
    };
}

export interface User {
    id: number;
    username: string;
    email: string;
    avatar?: string;
    is_admin: boolean;
    is_super_admin: boolean;
    current_org_id?: number;
    created_at: string;
}

export interface AuthOrganization {
    id: number;
    name: string;
    slug: string;
    description?: string;
    isActive: boolean;
}

export interface AuthRole {
    id: number;
    name: string;
    description?: string;
    isSystem: boolean;
}

export interface AuthPermission {
    id: number;
    resource: string;
    action: string;
    description?: string;
}

export interface AuthMeResponse {
    user: User;
    currentOrganization?: AuthOrganization;
    currentRole?: AuthRole;
    permissions?: AuthPermission[];
}

class AuthService {
    // 登录
    async login(credentials: LoginRequest): Promise<LoginResponse> {
        const response = await apiClient.post<LoginResponse>('/auth/login', credentials);

        // 保存token
        if (response.token) {
            apiClient.setAuthToken(response.token);
            // 保存用户信息
            if (response.user) {
                localStorage.setItem('user', JSON.stringify(response.user));
            }
        }

        return response;
    }

    // 登出
    async logout(): Promise<void> {
        try {
            await apiClient.post('/auth/logout');
        } catch (error) {
            // 即使API调用失败，也要清理本地状态
            console.error('Logout API error:', error);
        } finally {
            // 清理本地存储
            apiClient.clearAuthToken();
            localStorage.removeItem('user');
        }
    }

    // 获取当前用户信息（兼容新旧 API 格式）
    async getCurrentUser(): Promise<User> {
        const response = await apiClient.get<AuthMeResponse | User>('/auth/me');
        // 新 API 返回 { user, currentOrganization, ... }
        if ('user' in response && response.user) {
            localStorage.setItem('user', JSON.stringify(response.user));
            localStorage.setItem('auth_context', JSON.stringify(response));
            return response.user;
        }
        // 旧 API 直接返回 User 对象
        localStorage.setItem('user', JSON.stringify(response));
        return response as User;
    }

    // 获取完整的认证上下文（包含组织、角色、权限）
    async getAuthContext(): Promise<AuthMeResponse> {
        const response = await apiClient.get<AuthMeResponse>('/auth/me');
        localStorage.setItem('auth_context', JSON.stringify(response));
        if (response.user) {
            localStorage.setItem('user', JSON.stringify(response.user));
        }
        return response;
    }

    // 获取本地缓存的认证上下文
    getLocalAuthContext(): AuthMeResponse | null {
        const contextStr = localStorage.getItem('auth_context');
        if (contextStr) {
            try {
                return JSON.parse(contextStr);
            } catch {
                return null;
            }
        }
        return null;
    }

    // 检查是否已登录
    isAuthenticated(): boolean {
        const token = localStorage.getItem('auth_token');
        return !!token;
    }

    // 获取本地存储的用户信息
    getLocalUser(): User | null {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            try {
                return JSON.parse(userStr);
            } catch {
                return null;
            }
        }
        return null;
    }

    // 检查是否是管理员
    isAdmin(): boolean {
        const user = this.getLocalUser();
        return user?.is_admin || false;
    }

    // 更新用户信息
    async updateUser(data: UpdateUserRequest): Promise<User> {
        const response = await apiClient.put<User>('/auth/update', data);

        // 更新本地存储的用户信息
        localStorage.setItem('user', JSON.stringify(response));
        return response;
    }
}

export const authService = new AuthService();
