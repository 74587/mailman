import { apiClient } from '@/lib/api-client';

// Organization types
export interface Organization {
    id: number;
    name: string;
    slug: string;
    description?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface Role {
    id: number;
    orgId?: number;
    name: string;
    description?: string;
    isSystem: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface Permission {
    id: number;
    resource: string;
    action: string;
    description?: string;
}

export interface OrgMember {
    id: number;
    orgId: number;
    userId: number;
    roleId: number;
    joinedAt: string;
    createdAt: string;
    updatedAt: string;
    user?: {
        id: number;
        username: string;
        email: string;
        avatar?: string;
        is_super_admin: boolean;
        is_active: boolean;
    };
    role?: Role;
    organization?: Organization;
}

export interface CreateOrganizationRequest {
    name: string;
    slug: string;
    description?: string;
}

export interface AddMemberRequest {
    userId: number;
    roleId: number;
}

export interface UpdateMemberRoleRequest {
    roleId: number;
}

class OrganizationService {
    // 获取当前用户的组织列表
    async getOrganizations(): Promise<Organization[]> {
        return apiClient.get<Organization[]>('/organizations');
    }

    // 获取单个组织详情
    async getOrganization(id: number): Promise<Organization> {
        return apiClient.get<Organization>(`/organizations/${id}`);
    }

    // 创建组织（仅超管）
    async createOrganization(data: CreateOrganizationRequest): Promise<Organization> {
        return apiClient.post<Organization>('/organizations', data);
    }

    // 更新组织
    async updateOrganization(id: number, data: Partial<CreateOrganizationRequest>): Promise<Organization> {
        return apiClient.put<Organization>(`/organizations/${id}`, data);
    }

    // 删除组织（仅超管）
    async deleteOrganization(id: number): Promise<void> {
        return apiClient.delete(`/organizations/${id}`);
    }

    // 切换当前组织
    async switchOrganization(orgId: number): Promise<{ message: string; organization: Organization }> {
        return apiClient.post('/organizations/switch', { orgId });
    }

    // 获取组织成员列表
    async getOrgMembers(orgId: number): Promise<OrgMember[]> {
        return apiClient.get<OrgMember[]>(`/organizations/${orgId}/members`);
    }

    // 添加组织成员
    async addOrgMember(orgId: number, data: AddMemberRequest): Promise<OrgMember> {
        return apiClient.post<OrgMember>(`/organizations/${orgId}/members`, data);
    }

    // 更新成员角色
    async updateMemberRole(orgId: number, userId: number, data: UpdateMemberRoleRequest): Promise<void> {
        return apiClient.put(`/organizations/${orgId}/members/${userId}`, data);
    }

    // 移除成员
    async removeMember(orgId: number, userId: number): Promise<void> {
        return apiClient.delete(`/organizations/${orgId}/members/${userId}`);
    }

    // 获取系统角色列表
    async getRoles(): Promise<Role[]> {
        return apiClient.get<Role[]>('/roles');
    }

    // 创建角色
    async createRole(data: { name: string; description?: string; orgId?: number }): Promise<Role> {
        return apiClient.post<Role>('/roles', data);
    }

    // 更新角色
    async updateRole(id: number, data: { name?: string; description?: string }): Promise<Role> {
        return apiClient.put<Role>(`/roles/${id}`, data);
    }

    // 删除角色
    async deleteRole(id: number): Promise<void> {
        return apiClient.delete(`/roles/${id}`);
    }

    // 获取所有权限列表
    async getPermissions(): Promise<Permission[]> {
        return apiClient.get<Permission[]>('/permissions');
    }

    // 设置角色权限
    async setRolePermissions(roleId: number, permissionIds: number[]): Promise<void> {
        return apiClient.put(`/roles/${roleId}/permissions`, { permissionIds });
    }
}

export const organizationService = new OrganizationService();
