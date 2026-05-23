import { logger } from '@/lib/logger';
import { apiClient } from '@/lib/api-client'

export interface SystemConfig {
    key: string
    name: string
    description: string
    value_type: 'string' | 'number' | 'float' | 'boolean' | 'json'
    current_value: any
    default_value: any
    category: string
    is_editable: boolean
    is_visible: boolean
    updated_at: string
}

export interface SystemConfigUpdateRequest {
    value: any
}

class SystemConfigService {
    private baseUrl = ''

    /**
     * 获取所有系统配置
     */
    async getAllConfigs(): Promise<SystemConfig[]> {
        const response = await apiClient.get(`${this.baseUrl}/system-configs`)
        return response.data
    }

    /**
     * 根据分类获取配置
     */
    async getConfigsByCategory(category: string): Promise<SystemConfig[]> {
        const response = await apiClient.get(`${this.baseUrl}/system-configs/category/${category}`)
        return response.data
    }

    /**
     * 根据键获取配置
     */
    async getConfigByKey(key: string): Promise<SystemConfig> {
        logger.debug('[SystemConfigService] getConfigByKey 请求:', key)
        const response = await apiClient.get(`${this.baseUrl}/system-config/${key}`)
        logger.debug('[SystemConfigService] getConfigByKey 响应:', response)
        logger.debug('[SystemConfigService] response.data:', response.data)
        logger.debug('[SystemConfigService] response 结构:', Object.keys(response))

        // 尝试不同的数据访问方式
        const data = response.data || response
        logger.debug('[SystemConfigService] 使用的数据:', data)
        return data
    }

    /**
     * 更新配置值
     */
    async updateConfigValue(key: string, value: any): Promise<SystemConfig> {
        const response = await apiClient.put(`${this.baseUrl}/system-config/${key}`, {
            value
        })
        return response.data
    }

    /**
     * 重置配置为默认值
     */
    async resetConfigToDefault(key: string): Promise<SystemConfig> {
        const response = await apiClient.post(`${this.baseUrl}/system-config/${key}/reset`)
        return response.data
    }

    /**
     * 获取OAuth2自动打开配置
     */
    async getOAuth2AutoOpenConfig(): Promise<boolean> {
        try {
            const config = await this.getConfigByKey('oauth2-auto-open')
            logger.debug('[SystemConfigService] getOAuth2AutoOpenConfig - 原始配置:', config)
            logger.debug('[SystemConfigService] current_value:', config.current_value, 'type:', typeof config.current_value)
            const result = config.current_value === true
            logger.debug('[SystemConfigService] 最终返回值:', result)
            return result
        } catch (error) {
            console.warn('Failed to get OAuth2 auto-open config, using default:', error)
            return true // 默认值
        }
    }

    /**
     * 设置OAuth2自动打开配置
     */
    async setOAuth2AutoOpenConfig(autoOpen: boolean): Promise<void> {
        await this.updateConfigValue('oauth2-auto-open', autoOpen)
    }

    /**
     * 获取开发者模式配置
     */
    async getDeveloperModeConfig(): Promise<boolean> {
        try {
            const config = await this.getConfigByKey('developer-mode')
            logger.debug('[SystemConfigService] getDeveloperModeConfig - 原始配置:', config)
            logger.debug('[SystemConfigService] current_value:', config.current_value, 'type:', typeof config.current_value)
            const result = config.current_value === true
            logger.debug('[SystemConfigService] 最终返回值:', result)
            return result
        } catch (error) {
            console.warn('Failed to get developer mode config, using default:', error)
            return false // 默认关闭开发者模式
        }
    }

    /**
     * 设置开发者模式配置
     */
    async setDeveloperModeConfig(developerMode: boolean): Promise<void> {
        await this.updateConfigValue('developer-mode', developerMode)
    }

    /**
     * 获取配置的显示值（格式化后的值）
     */
    formatConfigValue(config: SystemConfig): string {
        const value = config.current_value

        switch (config.value_type) {
            case 'boolean':
                return value ? '是' : '否'
            case 'string':
                return value || '(空)'
            case 'number':
            case 'float':
                return value?.toString() || '0'
            case 'json':
                return JSON.stringify(value, null, 2)
            default:
                return String(value || '')
        }
    }

    /**
     * 验证配置值格式
     */
    validateConfigValue(config: SystemConfig, value: any): { valid: boolean; error?: string } {
        switch (config.value_type) {
            case 'string':
                if (typeof value !== 'string') {
                    return { valid: false, error: '必须是字符串类型' }
                }
                break
            case 'number':
                if (typeof value !== 'number' || !Number.isInteger(value)) {
                    return { valid: false, error: '必须是整数类型' }
                }
                break
            case 'float':
                if (typeof value !== 'number') {
                    return { valid: false, error: '必须是数值类型' }
                }
                break
            case 'boolean':
                if (typeof value !== 'boolean') {
                    return { valid: false, error: '必须是布尔类型' }
                }
                break
            case 'json':
                try {
                    JSON.stringify(value)
                } catch (error) {
                    return { valid: false, error: '必须是有效的JSON格式' }
                }
                break
            default:
                return { valid: false, error: '未知的配置类型' }
        }

        return { valid: true }
    }

    /**
     * 获取配置分组
     */
    groupConfigsByCategory(configs: SystemConfig[]): Record<string, SystemConfig[]> {
        return configs.reduce((groups, config) => {
            const category = config.category || 'general'
            if (!groups[category]) {
                groups[category] = []
            }
            groups[category].push(config)
            return groups
        }, {} as Record<string, SystemConfig[]>)
    }

    /**
     * 获取分类的显示名称
     */
    getCategoryDisplayName(category: string): string {
        const categoryNames: Record<string, string> = {
            'oauth2': 'OAuth2授权',
            'email': '邮件相关',
            'sync': '同步设置',
            'notification': '通知设置',
            'general': '常规设置',
            'ui': 'UI界面',
            'security': '安全设置',
            'keyboard': '快捷键'
        }

        return categoryNames[category] || category
    }

    /**
     * 获取登录页主题（公开API，无需认证）
     */
    async getLoginTheme(): Promise<string> {
        try {
            const response = await fetch('/api/public/login-theme')
            if (!response.ok) {
                return 'classic'
            }
            const data = await response.json()
            return data.theme || 'classic'
        } catch (error) {
            console.warn('Failed to get login theme, using default:', error)
            return 'classic'
        }
    }

    /**
     * 设置登录页主题
     */
    async setLoginTheme(theme: string): Promise<void> {
        await this.updateConfigValue('login-theme', theme)
    }
}

export const systemConfigService = new SystemConfigService()