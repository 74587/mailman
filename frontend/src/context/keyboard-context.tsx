'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

// 快捷操作项
export interface ShortcutAction {
    id: string
    name: string
    icon?: React.ComponentType<{ className?: string }>
    onExecute: () => void
}

// 快捷操作分类
export interface ShortcutCategory {
    id: string
    name: string
    icon?: React.ComponentType<{ className?: string }>
    actions: ShortcutAction[]
}

// 快捷键配置
export interface ShortcutConfig {
    key: string           // 主键，例如 'e'
    metaKey?: boolean     // ⌘ (Mac) 或 Ctrl (Windows)
    altKey?: boolean
    shiftKey?: boolean
}

interface KeyboardContextValue {
    // 命令面板状态
    isPaletteOpen: boolean
    openPalette: () => void
    closePalette: () => void
    togglePalette: () => void

    // 分类和操作
    categories: ShortcutCategory[]
    registerCategory: (category: ShortcutCategory) => void
    unregisterCategory: (categoryId: string) => void
    updateCategory: (categoryId: string, actions: ShortcutAction[]) => void

    // 全局快捷键配置
    shortcutConfig: ShortcutConfig
    setShortcutConfig: (config: ShortcutConfig) => void
}

const KeyboardContext = createContext<KeyboardContextValue | null>(null)

export function useKeyboard() {
    const context = useContext(KeyboardContext)
    if (!context) {
        throw new Error('useKeyboard must be used within a KeyboardProvider')
    }
    return context
}

interface KeyboardProviderProps {
    children: ReactNode
}

export function KeyboardProvider({ children }: KeyboardProviderProps) {
    const [isPaletteOpen, setIsPaletteOpen] = useState(false)
    const [categories, setCategories] = useState<ShortcutCategory[]>([])
    const [shortcutConfig, setShortcutConfig] = useState<ShortcutConfig>({
        key: 'e',
        metaKey: true,  // ⌘+E on Mac, Ctrl+E on Windows
    })

    // 打开/关闭命令面板
    const openPalette = useCallback(() => setIsPaletteOpen(true), [])
    const closePalette = useCallback(() => setIsPaletteOpen(false), [])
    const togglePalette = useCallback(() => setIsPaletteOpen(prev => !prev), [])

    // 注册分类
    const registerCategory = useCallback((category: ShortcutCategory) => {
        setCategories(prev => {
            // 避免重复注册
            const exists = prev.find(c => c.id === category.id)
            if (exists) {
                return prev.map(c => c.id === category.id ? category : c)
            }
            return [...prev, category]
        })
    }, [])

    // 取消注册分类
    const unregisterCategory = useCallback((categoryId: string) => {
        setCategories(prev => prev.filter(c => c.id !== categoryId))
    }, [])

    // 更新分类的操作列表
    const updateCategory = useCallback((categoryId: string, actions: ShortcutAction[]) => {
        setCategories(prev => prev.map(c =>
            c.id === categoryId ? { ...c, actions } : c
        ))
    }, [])

    // 全局键盘事件监听
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
            const modifierKey = isMac ? event.metaKey : event.ctrlKey

            // CMD/Ctrl + G: 快速查找邮件（聚焦搜索框）
            if (modifierKey && event.key.toLowerCase() === 'g') {
                event.preventDefault()
                event.stopPropagation()
                // 触发全局搜索聚焦事件
                window.dispatchEvent(new CustomEvent('focusGlobalSearch'))
                return
            }

            // 检查是否匹配快捷键配置（命令面板）
            const modifierMatch = isMac
                ? event.metaKey === !!shortcutConfig.metaKey
                : event.ctrlKey === !!shortcutConfig.metaKey

            if (
                modifierMatch &&
                event.altKey === !!shortcutConfig.altKey &&
                event.shiftKey === !!shortcutConfig.shiftKey &&
                event.key.toLowerCase() === shortcutConfig.key.toLowerCase()
            ) {
                event.preventDefault()
                event.stopPropagation()
                togglePalette()
            }

            // ESC 关闭面板
            if (event.key === 'Escape' && isPaletteOpen) {
                event.preventDefault()
                closePalette()
            }
        }

        document.addEventListener('keydown', handleKeyDown, true)
        return () => document.removeEventListener('keydown', handleKeyDown, true)
    }, [shortcutConfig, isPaletteOpen, togglePalette, closePalette])

    const value: KeyboardContextValue = {
        isPaletteOpen,
        openPalette,
        closePalette,
        togglePalette,
        categories,
        registerCategory,
        unregisterCategory,
        updateCategory,
        shortcutConfig,
        setShortcutConfig,
    }

    return (
        <KeyboardContext.Provider value={value}>
            {children}
        </KeyboardContext.Provider>
    )
}
