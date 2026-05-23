'use client'

/**
 * Hint Mode - 类似 Vimium 的元素标签功能
 * 按 CMD+J 激活后，在页面可交互元素上显示字母标签
 * 用户输入字母即可点击/聚焦对应元素
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/logger'

interface HintElement {
    element: HTMLElement
    hint: string
    rect: DOMRect
    type: 'interactive' | 'scrollable'  // 元素类型：可交互 或 可滚动
}

// 生成 hint 标签的字符集
const HINT_CHARS = 'asdfghjklqwertyuiopzxcvbnm'

/**
 * 根据元素数量生成 hint 标签
 * 始终生成至少 2 个字符的标签，避免与命令字符冲突
 * 比如 'y' 用于进入 Copy Mode，'/' 用于搜索等
 */
function generateHints(count: number): string[] {
    const hints: string[] = []
    const chars = HINT_CHARS.split('')
    const base = chars.length

    // 强制使用至少 2 个字符，为命令字符保留空间
    // 这样单字符（如 y, /, ?）可以安全地用作命令触发键
    const minLength = 2
    const len = Math.max(minLength, Math.ceil(Math.log(count) / Math.log(base)))

    for (let i = 0; i < count; i++) {
        let hint = ''
        let n = i
        for (let j = 0; j < len; j++) {
            hint = chars[n % base] + hint
            n = Math.floor(n / base)
        }
        hints.push(hint)
    }

    return hints
}

/**
 * 查找页面上所有可交互元素
 */
function findInteractiveElements(): HTMLElement[] {
    // 首先通过选择器获取明确的可交互元素
    const selectors = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[role="button"]:not([disabled])',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="listitem"]',
        '[role="tab"]',
        '[role="checkbox"]:not([disabled])',
        '[role="radio"]:not([disabled])',
        '[role="switch"]:not([disabled])',
        '[tabindex]:not([tabindex="-1"]):not([disabled])',
        '[contenteditable="true"]',
        'summary',
        'label[for]',
        'li',  // 列表项可能是可点击的
    ]

    const selectorElements = document.querySelectorAll<HTMLElement>(selectors.join(','))

    // 另外检测所有有 cursor: pointer 样式的元素（React onClick 等）
    const allElements = document.querySelectorAll<HTMLElement>('*')
    const cursorPointerElements: HTMLElement[] = []

    allElements.forEach(el => {
        // 跳过已经通过选择器获取的元素
        if (Array.from(selectorElements).includes(el)) return

        // 跳过容器类元素
        const tagName = el.tagName.toLowerCase()
        if (['html', 'body', 'head', 'script', 'style', 'svg', 'path', 'g', 'defs', 'clippath'].includes(tagName)) return

        const style = window.getComputedStyle(el)

        // 检测 cursor: pointer
        if (style.cursor === 'pointer') {
            // 确保元素有合理的尺寸
            const rect = el.getBoundingClientRect()
            if (rect.width >= 10 && rect.height >= 10 && rect.width < 1000 && rect.height < 500) {
                cursorPointerElements.push(el)
            }
        }
    })

    // 合并两个列表，去重
    const allInteractive = new Set([...Array.from(selectorElements), ...cursorPointerElements])

    // 过滤掉不可见或被遮挡的元素
    const filtered = Array.from(allInteractive).filter(el => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)

        // 基本可见性检查
        if (
            rect.width <= 0 ||
            rect.height <= 0 ||
            rect.bottom < 0 ||
            rect.top > window.innerHeight ||
            rect.right < 0 ||
            rect.left > window.innerWidth ||
            style.visibility === 'hidden' ||
            style.display === 'none' ||
            style.opacity === '0' ||
            parseFloat(style.opacity) < 0.1
        ) {
            return false
        }

        // 检查元素是否被其他元素遮挡
        // 在元素的多个点进行检测，提高准确性
        const checkPoints = [
            { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },  // 中心
            { x: rect.left + 5, y: rect.top + 5 },  // 左上角（偏移一点避免边缘问题）
        ]

        for (const point of checkPoints) {
            // 确保点在视口内
            if (point.x < 0 || point.x > window.innerWidth ||
                point.y < 0 || point.y > window.innerHeight) {
                continue
            }

            const topElement = document.elementFromPoint(point.x, point.y)

            // 检查点击到的元素是否是目标元素本身或其子元素
            if (topElement && (el === topElement || el.contains(topElement) || topElement.contains(el))) {
                return true
            }
        }

        return false
    })

    // 去除嵌套元素：如果一个元素是另一个元素的子元素，只保留外层元素
    // 这样避免一个按钮和它内部的图标都被标记
    const deduped: HTMLElement[] = []

    for (const el of filtered) {
        // 检查这个元素是否是已添加元素的子元素
        const isChildOfExisting = deduped.some(existing => existing.contains(el) && existing !== el)
        if (isChildOfExisting) continue

        // 检查已添加的元素中是否有这个元素的子元素，如果有则移除
        const childrenIndices: number[] = []
        deduped.forEach((existing, index) => {
            if (el.contains(existing) && el !== existing) {
                childrenIndices.push(index)
            }
        })

        // 从后往前移除子元素
        childrenIndices.reverse().forEach(index => deduped.splice(index, 1))

        deduped.push(el)
    }

    return deduped
}

/**
 * 查找页面上所有可滚动的容器
 */
function findScrollableElements(): HTMLElement[] {
    const allElements = document.querySelectorAll<HTMLElement>('*')
    const scrollables: HTMLElement[] = []

    allElements.forEach(el => {
        const style = window.getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        const tagName = el.tagName.toLowerCase()

        // 元素必须可见且有合理的尺寸
        if (
            rect.width < 100 ||
            rect.height < 100 ||
            rect.bottom < 0 ||
            rect.top > window.innerHeight ||
            rect.right < 0 ||
            rect.left > window.innerWidth ||
            style.visibility === 'hidden' ||
            style.display === 'none'
        ) {
            return // 跳过不可见或太小的元素
        }

        // 排除 body 和 html
        if (tagName === 'body' || tagName === 'html') {
            return
        }

        // 特殊处理 iframe - iframe 本身就是可滚动的容器
        if (tagName === 'iframe') {
            scrollables.push(el)
            return
        }

        // 检查是否有溢出内容（可以滚动的条件）
        const canScrollVertically = el.scrollHeight > el.clientHeight + 5  // 加点容差
        const canScrollHorizontally = el.scrollWidth > el.clientWidth + 5

        // 只检测真正允许滚动的 overflow 属性
        // 注意：overflow: hidden 会隐藏溢出内容，不能滚动！
        const overflowY = style.overflowY
        const overflowX = style.overflowX

        const canScrollY = (overflowY === 'auto' || overflowY === 'scroll') && canScrollVertically
        const canScrollX = (overflowX === 'auto' || overflowX === 'scroll') && canScrollHorizontally

        const isScrollable = canScrollY || canScrollX

        if (isScrollable) {
            scrollables.push(el)
        }
    })

    logger.debug('[ScrollableElements] Found scrollable elements:', scrollables.length,
        scrollables.map(el => ({
            tag: el.tagName,
            class: el.className?.slice?.(0, 60),
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            overflowY: window.getComputedStyle(el).overflowY
        }))
    )

    // 去除嵌套的滚动容器，只保留最内层的
    const deduped: HTMLElement[] = []
    for (const el of scrollables) {
        // 检查是否有子滚动容器
        const hasChildScrollable = scrollables.some(other => el.contains(other) && el !== other)
        if (!hasChildScrollable) {
            deduped.push(el)
        }
    }

    logger.debug('[ScrollableElements] After dedup:', deduped.length)
    return deduped
}

interface HintModeProps {
    isActive: boolean
    onClose: () => void
    onSelect: (element: HTMLElement, type: 'interactive' | 'scrollable') => void
}

export function HintMode({ isActive, onClose, onSelect }: HintModeProps) {
    const [hints, setHints] = useState<HintElement[]>([])
    const [input, setInput] = useState('')
    const inputRef = useRef('')

    // 激活时收集可交互元素和可滚动容器
    useEffect(() => {
        if (!isActive) {
            setHints([])
            setInput('')
            inputRef.current = ''
            return
        }

        // 收集可交互元素
        const interactiveElements = findInteractiveElements()
        // 收集可滚动容器
        const scrollableElements = findScrollableElements()

        // 合并所有元素
        const allElements: { element: HTMLElement; type: 'interactive' | 'scrollable' }[] = [
            ...interactiveElements.map(el => ({ element: el, type: 'interactive' as const })),
            ...scrollableElements.map(el => ({ element: el, type: 'scrollable' as const })),
        ]

        const hintLabels = generateHints(allElements.length)

        const hintElements: HintElement[] = allElements.map((item, index) => ({
            element: item.element,
            hint: hintLabels[index],
            rect: item.element.getBoundingClientRect(),
            type: item.type
        }))

        // 调试：检查滚动元素是否在 hints 中
        const scrollableHints = hintElements.filter(h => h.type === 'scrollable')
        logger.debug('[HintMode] Total hints:', hintElements.length, 'Scrollable hints:', scrollableHints.length)
        logger.debug('[HintMode] Scrollable hints:', scrollableHints.map(h => ({
            hint: h.hint,
            className: h.element.className?.slice?.(0, 50),
            rect: { top: h.rect.top, left: h.rect.left, width: h.rect.width, height: h.rect.height }
        })))

        setHints(hintElements)
    }, [isActive])

    // 处理键盘输入
    useEffect(() => {
        if (!isActive) return

        const handleKeyDown = (e: KeyboardEvent) => {
            // ESC 关闭
            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onClose()
                return
            }

            // Backspace 删除输入
            if (e.key === 'Backspace') {
                e.preventDefault()
                e.stopPropagation()
                setInput(prev => {
                    const newInput = prev.slice(0, -1)
                    inputRef.current = newInput
                    return newInput
                })
                return
            }

            // 只接受字母输入
            if (e.key.length === 1 && /^[a-z]$/i.test(e.key)) {
                e.preventDefault()
                e.stopPropagation()

                const newInput = inputRef.current + e.key.toLowerCase()
                inputRef.current = newInput
                setInput(newInput)

                // 检查是否有完全匹配
                const matchedHint = hints.find(h => h.hint === newInput)
                if (matchedHint) {
                    // 先关闭 HintMode，再执行选择操作
                    // 这样 handleSelect 可以在需要时重新设置滚动模式状态
                    onClose()
                    onSelect(matchedHint.element, matchedHint.type)
                    return
                }

                // 检查是否有部分匹配
                const partialMatches = hints.filter(h => h.hint.startsWith(newInput))
                if (partialMatches.length === 0) {
                    // 没有匹配，重置输入
                    inputRef.current = ''
                    setInput('')
                } else if (partialMatches.length === 1 && partialMatches[0].hint === newInput) {
                    // 唯一匹配
                    onClose()
                    onSelect(partialMatches[0].element, partialMatches[0].type)
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown, true)
        return () => document.removeEventListener('keydown', handleKeyDown, true)
    }, [isActive, hints, onClose, onSelect])

    if (!isActive || hints.length === 0) return null

    // 过滤显示的 hints（根据当前输入）
    const visibleHints = input
        ? hints.filter(h => h.hint.startsWith(input))
        : hints

    return ReactDOM.createPortal(
        <>
            {/* 背景遮罩 - 半透明 */}
            <div
                className="fixed inset-0 bg-black/10 z-[99998]"
                onClick={onClose}
            />

            {/* 输入提示 */}
            {input && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2 bg-gray-900 text-white rounded-lg shadow-lg text-lg font-mono">
                    输入: <span className="text-yellow-400 font-bold">{input.toUpperCase()}</span>
                    <span className="ml-4 text-gray-400 text-sm">
                        {visibleHints.length} 个匹配
                    </span>
                </div>
            )}

            {/* Hint 标签 */}
            {visibleHints.map((hint, index) => (
                <HintLabel
                    key={index}
                    hint={hint.hint}
                    rect={hint.rect}
                    matchedPart={input}
                    type={hint.type}
                />
            ))}

            {/* 底部提示 */}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[99999] px-4 py-2 bg-gray-900/90 text-white rounded-lg shadow-lg text-sm">
                <span className="text-gray-400">输入字母选择元素</span>
                <span className="mx-2">•</span>
                <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-xs">ESC</kbd>
                <span className="ml-1 text-gray-400">取消</span>
            </div>
        </>,
        document.body
    )
}

/**
 * 单个 Hint 标签
 */
function HintLabel({
    hint,
    rect,
    matchedPart,
    type
}: {
    hint: string
    rect: DOMRect
    matchedPart: string
    type: 'interactive' | 'scrollable'
}) {
    // 计算位置：在元素的左上角（稍微偏移，不遮挡元素内容）
    // 对于小元素，标签会稍微向上偏移
    const top = Math.max(4, rect.top)
    const left = Math.max(4, rect.left)

    // 滚动容器使用不同的样式（蓝色）
    const isScrollable = type === 'scrollable'

    return (
        <div
            className={cn(
                "fixed px-1 py-0.5 rounded-sm shadow-md",
                "text-[10px] font-bold font-mono uppercase pointer-events-none",
                isScrollable
                    ? "bg-blue-400 text-white border border-blue-600"
                    : "bg-yellow-400 text-gray-900 border border-yellow-600"
            )}
            style={{
                top: `${top}px`,
                left: `${left}px`,
                transform: 'translate(-2px, -2px)',  // 轻微偏移到元素外
                zIndex: 999999,
                minWidth: '14px',
                textAlign: 'center',
                lineHeight: '1.1',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }}
        >
            {isScrollable && <span className="mr-0.5">↕</span>}
            {matchedPart ? (
                <>
                    <span className={isScrollable ? "text-yellow-200" : "text-red-600"}>{matchedPart.toUpperCase()}</span>
                    <span>{hint.slice(matchedPart.length).toUpperCase()}</span>
                </>
            ) : (
                hint.toUpperCase()
            )}
        </div>
    )
}

export default HintMode
