/**
 * Tab Manager Hook
 * 提供统一的Tab管理接口，通过window事件与MainPage通信
 */

import { useCallback } from 'react'

export interface TabOpenOptions {
    id: string
    title?: string
    type?: string
    icon?: string
    closable?: boolean
    data?: Record<string, any>
}

export function useTabManager() {
    // 打开Tab
    const openTab = useCallback((options: TabOpenOptions) => {
        const { id, data } = options
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: id,
                data
            }
        }))
    }, [])

    // 关闭Tab
    const closeTab = useCallback((tabId: string) => {
        window.dispatchEvent(new CustomEvent('closeTab', {
            detail: { tabId }
        }))
    }, [])

    // 刷新Tab
    const refreshTab = useCallback((tabId: string) => {
        window.dispatchEvent(new CustomEvent('refreshTab', {
            detail: { tabId }
        }))
    }, [])

    // 切换到Tab
    const switchToTab = useCallback((tabId: string, data?: Record<string, any>) => {
        window.dispatchEvent(new CustomEvent('switchTab', {
            detail: {
                tab: tabId,
                data
            }
        }))
    }, [])

    return {
        openTab,
        closeTab,
        refreshTab,
        switchToTab,
    }
}
