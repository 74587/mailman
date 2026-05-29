import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { logger } from '@/lib/logger';

// API响应包装类型
export interface ApiResponse<T = any> {
    data: T;
    message?: string;
    error?: string;
    status?: string;
}

// API错误类型
export interface ApiError {
    message: string;
    code?: string;
    details?: any;
}

class ApiClient {
    private client: AxiosInstance;
    private baseURL: string;

    constructor() {
        // 根据Swagger文档，基础路径是 /api
        // 在生产环境或docker环境中使用相对路径，利用nginx代理
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ||
            (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8080');
        this.baseURL = apiUrl + '/api';

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        });

        this.setupInterceptors();
    }

    private setupInterceptors(): void {
        // 请求拦截器
        this.client.interceptors.request.use(
            (config) => {
                // 添加认证令牌
                const token = this.getAuthToken();
                if (token && config.headers) {
                    config.headers.Authorization = `Bearer ${token}`;
                }

                // 日志记录（开发环境）
                logger.debug(`[API Request] ${config.method?.toUpperCase()} ${config.url}`, config.data);

                return config;
            },
            (error) => {
                console.error('[API Request Error]', error);
                return Promise.reject(error);
            }
        );

        // 响应拦截器
        this.client.interceptors.response.use(
            (response) => {
                // 日志记录（开发环境）
                logger.debug(`[API Response] ${response.config.url}`, response.data);
                return response;
            },
            (error: AxiosError) => {
                // 统一错误处理
                if (error.response) {
                    const { status, data } = error.response;

                    switch (status) {
                        case 401:
                            this.handleUnauthorized();
                            break;
                        case 403:
                            console.error('访问被拒绝');
                            break;
                        case 404:
                            console.error('资源不存在');
                            break;
                        case 500:
                            console.error('服务器错误');
                            break;
                    }

                    // 返回格式化的错误
                    const errorMessage = (data as any)?.message ||
                        (data as any)?.error ||
                        error.message ||
                        '请求失败';

                    return Promise.reject(new Error(errorMessage));
                } else if (error.request) {
                    // 请求已发送但未收到响应
                    return Promise.reject(new Error('网络错误，请检查您的网络连接'));
                } else {
                    // 其他错误
                    return Promise.reject(new Error(error.message || '请求失败'));
                }
            }
        );
    }

    private getAuthToken(): string | null {
        // 从localStorage获取token
        if (typeof window !== 'undefined') {
            const token = localStorage.getItem('auth_token');
            if (token) return token;

            // One-time migration from legacy keys
            const legacyToken = localStorage.getItem('sessionToken') || localStorage.getItem('token');
            if (legacyToken) {
                localStorage.setItem('auth_token', legacyToken);
                localStorage.removeItem('sessionToken');
                localStorage.removeItem('token');
                return legacyToken;
            }
        }
        return null;
    }

    private handleUnauthorized(): void {
        // 清除认证信息
        if (typeof window !== 'undefined') {
            this.clearAuthToken();
            // 可选：触发全局登出事件
            window.dispatchEvent(new CustomEvent('auth:logout'));
            // 重定向到登录页（如果不在登录页或OAuth2页面）
            if (!window.location.pathname.includes('/login') &&
                !window.location.pathname.startsWith('/oauth2/')) {
                window.location.href = '/login';
            }
        }
    }

    // 通用请求方法 - 处理不同的响应格式
    async request<T = any>(config: AxiosRequestConfig): Promise<T> {
        try {
            const response: AxiosResponse = await this.client.request(config);

            // 根据响应内容类型和结构返回数据
            // 有些API直接返回数据，有些返回包装的响应

            // 如果响应是数组，直接返回
            if (Array.isArray(response.data)) {
                return response.data as T;
            }

            if (response.data && typeof response.data === 'object') {
                // 如果响应有data字段，可能是包装的响应
                if ('data' in response.data && Object.keys(response.data).length === 1) {
                    return response.data.data;
                }
                // 如果响应包含emails字段，这是邮件列表接口的特定结构
                if ('emails' in response.data) {
                    return response.data;
                }
                // 如果响应有特定的结构（如分页），保持原样
                if ('total' in response.data || 'results' in response.data || 'items' in response.data) {
                    return response.data;
                }
            }

            // 默认返回整个响应数据
            return response.data;
        } catch (error) {
            // 错误已在拦截器中处理
            throw error;
        }
    }

    // 便捷方法
    get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
        return this.request<T>({ ...config, method: 'GET', url });
    }

    post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        return this.request<T>({ ...config, method: 'POST', url, data });
    }

    put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        return this.request<T>({ ...config, method: 'PUT', url, data });
    }

    delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
        return this.request<T>({ ...config, method: 'DELETE', url });
    }

    patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        return this.request<T>({ ...config, method: 'PATCH', url, data });
    }

    // 特殊方法：处理文件下载
    async download(url: string, filename?: string): Promise<void> {
        try {
            const response = await this.client.get(url, {
                responseType: 'blob',
            });

            const blob = new Blob([response.data]);
            const downloadUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = filename || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            throw error;
        }
    }

    // 设置认证令牌
    setAuthToken(token: string): void {
        if (typeof window !== 'undefined') {
            // 统一使用 auth_token 作为键名
            localStorage.setItem('auth_token', token);
        }
    }

    // 清除认证令牌
    clearAuthToken(): void {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('auth_token');
            // Clean up legacy keys
            localStorage.removeItem('token');
            localStorage.removeItem('sessionToken');
        }
    }

    // 获取完整的API URL（用于调试或其他用途）
    getFullUrl(path: string): string {
        return `${this.baseURL}${path}`;
    }
}

// 导出单例实例
export const apiClient = new ApiClient();

// 导出类型
export type { ApiClient };
