'use client'

/**
 * Hint Mode Provider
 * 提供全局的 Hint Mode 状态管理
 * 支持三种模式：
 * 1. 标签模式 - 显示元素标签，输入字母选择元素
 * 2. 滚动模式 - 选中滚动容器后，使用方向键/HJKL滚动
 * 3. 复制模式 - 类似 Vim 的可视模式，搜索并选择文本区域进行复制
 */

import React, { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react'
import { HintMode } from './hint-mode'
import { CopyMode } from './copy-mode'
import { logger } from '@/lib/logger'

interface HintModeContextValue {
    isActive: boolean
    isScrollMode: boolean
    isCopyMode: boolean  // 新增：Copy Mode 状态
    scrollTarget: HTMLElement | null
    activate: () => void
    deactivate: () => void
    activateCopyMode: () => void  // 新增：激活 Copy Mode
    deactivateCopyMode: () => void  // 新增：关闭 Copy Mode
}

const HintModeContext = createContext<HintModeContextValue | null>(null)

export function useHintMode() {
    const context = useContext(HintModeContext)
    if (!context) {
        throw new Error('useHintMode must be used within a HintModeProvider')
    }
    return context
}

interface HintModeProviderProps {
    children: ReactNode
}

export function HintModeProvider({ children }: HintModeProviderProps) {
    const [isActive, setIsActive] = useState(false)
    const [isScrollMode, setIsScrollMode] = useState(false)
    const [isCopyMode, setIsCopyMode] = useState(false)  // 新增：Copy Mode 状态
    const [scrollTarget, setScrollTarget] = useState<HTMLElement | null>(null)
    const scrollTargetRef = useRef<HTMLElement | null>(null)

    const activate = useCallback(() => {
        setIsActive(true)
        setIsScrollMode(false)
        setIsCopyMode(false)
        setScrollTarget(null)
    }, [])

    const deactivate = useCallback(() => {
        setIsActive(false)
        setIsScrollMode(false)
        setScrollTarget(null)
        scrollTargetRef.current = null
    }, [])

    const exitScrollMode = useCallback(() => {
        setIsScrollMode(false)
        setScrollTarget(null)
        scrollTargetRef.current = null
    }, [])

    // 新增：激活 Copy Mode
    const activateCopyMode = useCallback(() => {
        setIsCopyMode(true)
        setIsActive(false)
        setIsScrollMode(false)
        setScrollTarget(null)
    }, [])

    // 新增：关闭 Copy Mode
    const deactivateCopyMode = useCallback(() => {
        setIsCopyMode(false)
    }, [])

    // 监听快捷键触发事件（通过键盘系统）
    useEffect(() => {
        const handleActivate = () => {
            activate()
        }

        window.addEventListener('activateHintMode', handleActivate)
        return () => window.removeEventListener('activateHintMode', handleActivate)
    }, [activate])

    // 备选：直接的全局快捷键监听（用于模态框等特殊场景）
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            logger.debug('[HintModeProvider] handleKeyDown called, key:', e.key, 'isCopyMode:', isCopyMode)
            // CMD/Ctrl + J 或 U 激活 Hint Mode
            if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
                if (e.key.toLowerCase() === 'j' || e.key.toLowerCase() === 'u') {
                    if (!isActive && !isScrollMode && !isCopyMode) {
                        e.preventDefault()
                        e.stopPropagation()
                        activate()
                    }
                }

                // CMD/Ctrl + Y 激活 Copy Mode - 功能已禁用
                // TODO: Copy Mode 的输入处理存在问题，暂时禁用
                // if (e.key.toLowerCase() === 'y') {
                //     if (!isCopyMode) {
                //         e.preventDefault()
                //         e.stopPropagation()
                //         // 先关闭其他模式
                //         if (isActive) {
                //             deactivate()
                //         }
                //         if (isScrollMode) {
                //             setIsScrollMode(false)
                //             setScrollTarget(null)
                //         }
                //         // 激活 Copy Mode
                //         activateCopyMode()
                //     }
                // }
            }
        }

        document.addEventListener('keydown', handleKeyDown, true)
        return () => document.removeEventListener('keydown', handleKeyDown, true)
    }, [activate, activateCopyMode, deactivate, isActive, isScrollMode, isCopyMode])

    // 滚动模式的键盘处理
    useEffect(() => {
        // 使用 scrollTarget 状态来判断，而不是 ref
        if (!isScrollMode || !scrollTarget) {
            logger.debug('[ScrollMode] Not active or no target:', { isScrollMode, scrollTarget: !!scrollTarget })
            return
        }

        logger.debug('[ScrollMode] Activating scroll mode for element:', scrollTarget)

        /**
         * 获取实际的滚动目标
         * 对于 iframe，需要滚动其内部的 document body
         */
        const getScrollTarget = (): Element | null => {
            if (scrollTarget.tagName.toLowerCase() === 'iframe') {
                try {
                    const iframe = scrollTarget as HTMLIFrameElement
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
                    if (iframeDoc) {
                        // 先尝试 scrollingElement，再尝试 documentElement 或 body
                        return iframeDoc.scrollingElement || iframeDoc.documentElement || iframeDoc.body
                    }
                } catch (e) {
                    // iframe 可能跨域，无法访问
                    console.warn('[ScrollMode] Cannot access iframe content (possibly cross-origin)')
                    return null
                }
            }
            return scrollTarget
        }

        const handleScrollKeyDown = (e: KeyboardEvent) => {
            const target = getScrollTarget()
            if (!target) return

            const scrollAmount = 100  // 每次滚动的像素数
            const key = e.key.toLowerCase()

            logger.debug('[ScrollMode] Key pressed:', e.key)

            // ESC 退出滚动模式
            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                exitScrollMode()
                return
            }

            // 方向键和 HJKL 滚动
            let handled = false
            if (key === 'j' || e.key === 'ArrowDown') {
                logger.debug('[ScrollMode] Scrolling down')
                target.scrollBy({ top: scrollAmount, behavior: 'smooth' })
                handled = true
            } else if (key === 'k' || e.key === 'ArrowUp') {
                logger.debug('[ScrollMode] Scrolling up')
                target.scrollBy({ top: -scrollAmount, behavior: 'smooth' })
                handled = true
            } else if (key === 'h' || e.key === 'ArrowLeft') {
                target.scrollBy({ left: -scrollAmount, behavior: 'smooth' })
                handled = true
            } else if (key === 'l' || e.key === 'ArrowRight') {
                target.scrollBy({ left: scrollAmount, behavior: 'smooth' })
                handled = true
            } else if (key === 'g' && !e.shiftKey) {
                // g 滚动到顶部
                target.scrollTo({ top: 0, behavior: 'smooth' })
                handled = true
            } else if (e.shiftKey && key === 'g') {
                // Shift+G 滚动到底部
                target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' })
                handled = true
            } else if (key === 'd') {
                // d 向下半页
                target.scrollBy({ top: (target as HTMLElement).clientHeight / 2, behavior: 'smooth' })
                handled = true
            } else if (key === 'u' && !e.metaKey && !e.ctrlKey) {
                // u 向上半页 (排除 CMD+U)
                target.scrollBy({ top: -(target as HTMLElement).clientHeight / 2, behavior: 'smooth' })
                handled = true
            }

            if (handled) {
                e.preventDefault()
                e.stopPropagation()
            }
        }

        document.addEventListener('keydown', handleScrollKeyDown, true)
        return () => document.removeEventListener('keydown', handleScrollKeyDown, true)
    }, [isScrollMode, scrollTarget, exitScrollMode])

    const handleSelect = useCallback((element: HTMLElement, type: 'interactive' | 'scrollable') => {
        if (type === 'scrollable') {
            // 进入滚动模式
            setIsActive(false)
            setIsScrollMode(true)
            setScrollTarget(element)
            scrollTargetRef.current = element

            // 高亮显示滚动容器
            element.style.outline = '3px solid #3b82f6'
            element.style.outlineOffset = '2px'
        } else {
            // 普通交互元素
            const tagName = element.tagName.toLowerCase()

            if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
                element.focus()
            } else if (tagName === 'a' || element.getAttribute('role') === 'link') {
                element.click()
            } else if (element.getAttribute('contenteditable') === 'true') {
                element.focus()
            } else {
                element.click()
            }
        }
    }, [])

    // 清理滚动容器的高亮
    useEffect(() => {
        return () => {
            if (scrollTargetRef.current) {
                scrollTargetRef.current.style.outline = ''
                scrollTargetRef.current.style.outlineOffset = ''
            }
        }
    }, [])

    // 退出滚动模式时清理高亮
    useEffect(() => {
        if (!isScrollMode && scrollTarget) {
            scrollTarget.style.outline = ''
            scrollTarget.style.outlineOffset = ''
        }
    }, [isScrollMode, scrollTarget])

    const value: HintModeContextValue = {
        isActive,
        isScrollMode,
        isCopyMode,
        scrollTarget,
        activate,
        deactivate,
        activateCopyMode,
        deactivateCopyMode
    }

    return (
        <HintModeContext.Provider value={value}>
            {children}
            <HintMode
                isActive={isActive}
                onClose={deactivate}
                onSelect={handleSelect}
            />
            {/* Copy Mode - 功能已禁用 */}
            {/* <CopyMode
                isActive={isCopyMode}
                onClose={deactivateCopyMode}
            /> */}
            {/* 滚动模式提示 */}
            {isScrollMode && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2 bg-blue-600 text-white rounded-lg shadow-lg text-sm">
                    <span className="font-bold">滚动模式</span>
                    <span className="mx-2">•</span>
                    <span className="text-blue-200">↑↓/JK 上下滚动</span>
                    <span className="mx-2">•</span>
                    <span className="text-blue-200">←→/HL 左右滚动</span>
                    <span className="mx-2">•</span>
                    <span className="text-blue-200">g/G 顶/底</span>
                    <span className="mx-2">•</span>
                    <span className="text-blue-200">d/u 半页</span>
                    <span className="mx-2">•</span>
                    <kbd className="px-1.5 py-0.5 bg-blue-700 rounded text-xs">ESC</kbd>
                    <span className="ml-1 text-blue-200">退出</span>
                </div>
            )}
        </HintModeContext.Provider>
    )
}
