'use client'
import { logger } from '@/lib/logger';

import * as React from 'react'
import {
    applyCustomThemeStyle,
    CUSTOM_THEME_CHANGE_EVENT,
    isCustomThemeTemporarilyDisabled,
    removeCustomThemeStyle,
    saveStoredCustomThemeConfig,
} from '@/lib/custom-theme'
import { systemConfigService } from '@/services/system-config.service'

type Theme = 'dark' | 'light' | 'system' | 'sakura' | 'custom'

type ThemeProviderProps = {
    children: React.ReactNode
    attribute?: string
    defaultTheme?: Theme
    enableSystem?: boolean
    storageKey?: string
}

type ThemeProviderState = {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(
    undefined
)

export function ThemeProvider({
    children,
    attribute = 'class',
    defaultTheme = 'system',
    enableSystem = true,
    storageKey = 'theme',
    ...props
}: ThemeProviderProps) {
    const [theme, setTheme] = React.useState<Theme>(defaultTheme)
    const [mounted, setMounted] = React.useState(false)

    React.useEffect(() => {
        if (typeof window === 'undefined') return

        setMounted(true)
        const storedTheme = localStorage.getItem(storageKey) as Theme
        logger.debug('[ThemeProvider] 初始化，存储的主题:', storedTheme)

        if (storedTheme) {
            setTheme(storedTheme)
        } else {
            // 如果没有存储的主题，检查系统偏好
            const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light'
            logger.debug('[ThemeProvider] 使用系统主题:', systemTheme)
            setTheme(defaultTheme === 'system' ? 'system' : systemTheme)
        }
    }, [storageKey, defaultTheme])

    React.useEffect(() => {
        if (!mounted || typeof window === 'undefined') return

        const root = window.document.documentElement
        logger.debug('[ThemeProvider] 应用主题变化:', theme)

        root.classList.remove('light', 'dark', 'sakura', 'custom-theme')
        logger.debug('[ThemeProvider] 移除类后的html类:', root.className)

        let appliedTheme: string
        if (theme === 'custom') {
            if (isCustomThemeTemporarilyDisabled()) {
                appliedTheme = 'light'
                removeCustomThemeStyle()
                logger.debug('[ThemeProvider] 自定义主题已被URL参数临时禁用')
            } else {
                appliedTheme = 'custom-theme'
                applyCustomThemeStyle()
                logger.debug('[ThemeProvider] 应用自定义主题')
            }
        } else if (theme === 'system' && enableSystem) {
            const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light'
            appliedTheme = systemTheme
            removeCustomThemeStyle()
            logger.debug('[ThemeProvider] 系统主题为:', systemTheme)
        } else {
            appliedTheme = theme
            removeCustomThemeStyle()
            logger.debug('[ThemeProvider] 直接应用主题:', theme)
        }

        root.classList.add(appliedTheme)
        logger.debug('[ThemeProvider] 应用主题后的html类:', root.className)
    }, [theme, enableSystem, mounted])

    React.useEffect(() => {
        if (!mounted || typeof window === 'undefined' || theme !== 'custom') return

        const hasAuthToken = Boolean(
            localStorage.getItem('auth_token') ||
            localStorage.getItem('sessionToken') ||
            localStorage.getItem('token')
        )

        if (hasAuthToken && !isCustomThemeTemporarilyDisabled()) {
            systemConfigService.getCustomThemeConfig()
                .then(remoteTheme => {
                    const cachedTheme = saveStoredCustomThemeConfig(remoteTheme)
                    applyCustomThemeStyle(cachedTheme)
                })
                .catch(error => {
                    logger.warn('[ThemeProvider] 加载数据库自定义主题失败，继续使用本地缓存:', error)
                })
        }

        const handleCustomThemeChange = () => {
            if (!isCustomThemeTemporarilyDisabled()) {
                applyCustomThemeStyle()
            }
        }

        window.addEventListener(CUSTOM_THEME_CHANGE_EVENT, handleCustomThemeChange)
        window.addEventListener('storage', handleCustomThemeChange)
        return () => {
            window.removeEventListener(CUSTOM_THEME_CHANGE_EVENT, handleCustomThemeChange)
            window.removeEventListener('storage', handleCustomThemeChange)
        }
    }, [mounted, theme])

    // Listen for system theme changes
    React.useEffect(() => {
        if (!mounted || !enableSystem || theme !== 'system') return

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

        const handleChange = () => {
            const root = window.document.documentElement
            root.classList.remove('light', 'dark', 'sakura', 'custom-theme')
            const systemTheme = mediaQuery.matches ? 'dark' : 'light'
            root.classList.add(systemTheme)
        }

        mediaQuery.addEventListener('change', handleChange)
        return () => mediaQuery.removeEventListener('change', handleChange)
    }, [mounted, enableSystem, theme])

    const value = React.useMemo(
        () => ({
            theme,
            setTheme: (newTheme: Theme) => {
                logger.debug('[ThemeProvider] setTheme 被调用:', theme, '->', newTheme)
                if (typeof window !== 'undefined') {
                    localStorage.setItem(storageKey, newTheme)
                    logger.debug('[ThemeProvider] 主题已保存到 localStorage:', newTheme)
                }
                setTheme(newTheme)
            },
        }),
        [theme, storageKey]
    )

    if (!mounted) {
        return <>{children}</>
    }

    return (
        <ThemeProviderContext.Provider {...props} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    )
}

export const useTheme = () => {
    const context = React.useContext(ThemeProviderContext)

    if (context === undefined) {
        // During SSR or before ThemeProvider is ready, return a working fallback
        const fallbackTheme = typeof window !== 'undefined'
            ? (localStorage.getItem('theme') as Theme) || 'system'
            : 'system'

        return {
            theme: fallbackTheme,
            setTheme: (newTheme: Theme) => {
                if (typeof window !== 'undefined') {
                    localStorage.setItem('theme', newTheme)
                    const root = window.document.documentElement
                    root.classList.remove('light', 'dark', 'sakura', 'custom-theme')

                    if (newTheme === 'custom') {
                        if (isCustomThemeTemporarilyDisabled()) {
                            removeCustomThemeStyle()
                            root.classList.add('light')
                        } else {
                            applyCustomThemeStyle()
                            root.classList.add('custom-theme')
                        }
                    } else if (newTheme === 'system') {
                        removeCustomThemeStyle()
                        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
                            ? 'dark'
                            : 'light'
                        root.classList.add(systemTheme)
                    } else {
                        removeCustomThemeStyle()
                        root.classList.add(newTheme)
                    }
                }
            }
        }
    }

    return context
}
