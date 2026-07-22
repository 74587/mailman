'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { authService, User, AuthOrganization, AuthRole, AuthPermission } from '@/services/auth.service';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import { getAuthReturnUrl, rememberAuthReturnUrl } from '@/lib/auth-return-url';

interface AuthContextType {
    user: User | null;
    currentOrganization: AuthOrganization | null;
    currentRole: AuthRole | null;
    permissions: AuthPermission[];
    isLoading: boolean;
    isAuthenticated: boolean;
    isSuperAdmin: boolean;
    login: (username: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    hasPermission: (resource: string, action: string) => boolean;
    switchOrganization: (orgId: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [currentOrganization, setCurrentOrganization] = useState<AuthOrganization | null>(null);
    const [currentRole, setCurrentRole] = useState<AuthRole | null>(null);
    const [permissions, setPermissions] = useState<AuthPermission[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    // 加载完整的认证上下文
    const loadAuthContext = useCallback(async () => {
        try {
            const context = await authService.getAuthContext();
            setUser(context.user);
            setCurrentOrganization(context.currentOrganization || null);
            setCurrentRole(context.currentRole || null);
            setPermissions(context.permissions || []);
        } catch (error: any) {
            // 如果新 API 失败，回退到旧方式
            try {
                const currentUser = await authService.getCurrentUser();
                setUser(currentUser);
            } catch {
                throw error;
            }
        }
    }, []);

    // 初始化时检查认证状态
    useEffect(() => {
        const initAuth = async () => {
            logger.debug('[AuthContext] Starting auth initialization');

            try {
                // 尝试从多个可能的键获取 token
                const token = localStorage.getItem('auth_token') ||
                    localStorage.getItem('token') ||
                    localStorage.getItem('sessionToken');
                logger.debug('[AuthContext] Token exists:', !!token);

                if (token) {
                    // 先尝试使用本地用户信息
                    const localUser = authService.getLocalUser();
                    if (localUser) {
                        logger.debug('[AuthContext] Found local user:', localUser.email);
                        setUser(localUser);
                    }

                    // 加载本地缓存的上下文
                    const localContext = authService.getLocalAuthContext();
                    if (localContext) {
                        setCurrentOrganization(localContext.currentOrganization || null);
                        setCurrentRole(localContext.currentRole || null);
                        setPermissions(localContext.permissions || []);
                    }

                    // 异步验证并刷新完整上下文
                    try {
                        await loadAuthContext();
                    } catch (error: any) {
                        console.error('[AuthContext] Token validation failed:', error);
                        if (error.response?.status === 401) {
                            logger.debug('[AuthContext] 401 error, clearing auth state');
                            apiClient.clearAuthToken();
                            localStorage.removeItem('user');
                            localStorage.removeItem('auth_context');
                            setUser(null);
                            setCurrentOrganization(null);
                            setCurrentRole(null);
                            setPermissions([]);
                            const currentPath = window.location.pathname;
                            const isOAuth2Callback = currentPath.startsWith('/oauth2/callback') ||
                                                   currentPath.match(/^\/oauth2\/callback\/[^\/]+$/);
                            if (currentPath !== '/login' && !isOAuth2Callback) {
                                rememberAuthReturnUrl();
                                router.push('/login');
                            }
                        }
                    }
                } else {
                    logger.debug('[AuthContext] No token found');
                    setUser(null);
                }
            } catch (error) {
                console.error('[AuthContext] Unexpected error during init:', error);
            } finally {
                logger.debug('[AuthContext] Auth initialization complete');
                setIsLoading(false);
            }
        };

        initAuth();
    }, []);

    // 监听登出事件
    useEffect(() => {
        const handleLogout = () => {
            setUser(null);
            setCurrentOrganization(null);
            setCurrentRole(null);
            setPermissions([]);
            router.push('/login');
        };

        window.addEventListener('auth:logout', handleLogout);
        return () => {
            window.removeEventListener('auth:logout', handleLogout);
        };
    }, [router]);

    const login = useCallback(async (username: string, password: string) => {
        try {
            const response = await authService.login({ username, password });
            setUser(response.user);
            // 登录后加载完整上下文
            try {
                await loadAuthContext();
            } catch {
                // 忽略，至少 user 已经设置
            }
            toast.success('登录成功');
            router.push(getAuthReturnUrl());
        } catch (error) {
            const message = error instanceof Error ? error.message : '登录失败';
            toast.error(message);
            throw error;
        }
    }, [router, loadAuthContext]);

    const logout = useCallback(async () => {
        try {
            await authService.logout();
            setUser(null);
            setCurrentOrganization(null);
            setCurrentRole(null);
            setPermissions([]);
            localStorage.removeItem('auth_context');
            toast.success('已退出登录');
            router.push('/login');
        } catch (error) {
            console.error('Logout error:', error);
            setUser(null);
            setCurrentOrganization(null);
            setCurrentRole(null);
            setPermissions([]);
            router.push('/login');
        }
    }, [router]);

    const refreshUser = useCallback(async () => {
        try {
            await loadAuthContext();
        } catch (error) {
            console.error('Failed to refresh user:', error);
            throw error;
        }
    }, [loadAuthContext]);

    // 权限检查
    const hasPermission = useCallback((resource: string, action: string): boolean => {
        if (user?.is_super_admin) return true;
        return permissions.some(p =>
            p.resource === resource && (p.action === action || p.action === 'manage')
        );
    }, [user, permissions]);

    // 切换组织
    const switchOrganization = useCallback(async (orgId: number) => {
        try {
            const { organizationService } = await import('@/services/organization.service');
            await organizationService.switchOrganization(orgId);
            await loadAuthContext();
            toast.success('已切换组织');
        } catch (error) {
            const message = error instanceof Error ? error.message : '切换组织失败';
            toast.error(message);
            throw error;
        }
    }, [loadAuthContext]);

    const value: AuthContextType = {
        user,
        currentOrganization,
        currentRole,
        permissions,
        isLoading,
        isAuthenticated: !!user,
        isSuperAdmin: user?.is_super_admin || false,
        login,
        logout,
        refreshUser,
        hasPermission,
        switchOrganization,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
