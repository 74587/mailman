'use client'

/**
 * Copy Mode - 文本视觉复制模式
 * 
 * 类似 Vim 的可视模式，允许用户通过搜索来选择页面上的文本区域
 * 
 * 流程：
 * 1. 按 `CMD+Y` 进入 Copy Mode
 * 2. 按 `/` 开始搜索，输入搜索文本
 * 3. 匹配的文本高亮显示，显示标签（跳过 n/N）
 * 4. 输入标签或按 `n`/`N` 跳转，`Enter` 确认开始位置
 * 5. 再次 `/` 搜索结束位置
 * 6. `Enter` 确认结束位置
 * 7. 显示选中区域，`y` 复制到剪贴板
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ReactDOM from 'react-dom'
import { logger } from '@/lib/logger'

// Copy Mode 的状态阶段
type CopyModePhase =
    | 'idle'           // 空闲，等待进入
    | 'ready'          // 进入 Copy Mode，等待搜索
    | 'searching_start' // 正在搜索开始位置
    | 'navigating_start' // 搜索完成，在匹配间导航选择开始位置
    | 'searching_end'   // 正在搜索结束位置
    | 'navigating_end'  // 搜索完成，在匹配间导航选择结束位置
    | 'selected'        // 选中完成，准备复制

interface TextMatch {
    text: string
    node: Text
    startOffset: number
    endOffset: number
    rect: DOMRect
    label: string  // 标签（跳过 n/N）
}

interface SelectionPoint {
    match: TextMatch
    position: 'start' | 'end'
}

interface CopyModeProps {
    isActive: boolean
    onClose: () => void
}

// 生成标签的字符集（跳过 n 和 N，因为它们用于导航）
const LABEL_CHARS = 'asdfghjklqwertyuiopzxcvbm'  // 去掉 n

/**
 * 生成标签列表
 */
function generateLabels(count: number): string[] {
    const labels: string[] = []
    const chars = LABEL_CHARS.split('')
    const base = chars.length

    // 始终使用至少 2 个字符
    const minLength = 2
    const len = Math.max(minLength, Math.ceil(Math.log(count) / Math.log(base)))

    for (let i = 0; i < count; i++) {
        let label = ''
        let num = i
        for (let j = 0; j < len; j++) {
            label = chars[num % base] + label
            num = Math.floor(num / base)
        }
        labels.push(label)
    }

    return labels
}

/**
 * 检查元素是否被遮挡（忽略 Copy Mode 自己的 UI）
 */
function isElementVisible(rect: DOMRect, textNode: Text): boolean {
    // 检查是否在视口内
    if (rect.width <= 0 || rect.height <= 0) return false
    if (rect.right < 0 || rect.left > window.innerWidth) return false
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false

    // 检查元素中心点是否被遮挡
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    // 暂时隐藏 Copy Mode UI 以便检测
    const copyModeUI = document.querySelectorAll('[data-copy-mode-ui]')
    copyModeUI.forEach(el => {
        (el as HTMLElement).style.pointerEvents = 'none'
    })

    const elementAtPoint = document.elementFromPoint(centerX, centerY)

    // 恢复 pointer events
    copyModeUI.forEach(el => {
        (el as HTMLElement).style.pointerEvents = ''
    })

    if (!elementAtPoint) return false

    // 检查点击到的元素是否包含目标文本节点，或者被目标文本节点的父元素包含
    const textParent = textNode.parentElement
    if (!textParent) return false

    // 如果点击到的元素是目标的祖先或后代，认为可见
    if (elementAtPoint === textParent ||
        elementAtPoint.contains(textParent) ||
        textParent.contains(elementAtPoint)) {
        return true
    }

    return false
}

export function CopyMode({ isActive, onClose }: CopyModeProps) {
    // 阶段状态
    const [phase, setPhase] = useState<CopyModePhase>('idle')
    const phaseRef = useRef<CopyModePhase>('idle')  // 保存最新的 phase，避免闭包问题

    // 搜索相关
    const [searchQuery, setSearchQuery] = useState('')
    const [matches, setMatches] = useState<TextMatch[]>([])
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
    const [labelInput, setLabelInput] = useState('')  // 用户输入的标签

    // 选区相关
    const [startPoint, setStartPoint] = useState<SelectionPoint | null>(null)
    const [endPoint, setEndPoint] = useState<SelectionPoint | null>(null)

    // 引用
    const inputRef = useRef<HTMLInputElement>(null)

    // 同步 phaseRef
    useEffect(() => {
        phaseRef.current = phase
    }, [phase])

    // 重置状态
    const reset = useCallback(() => {
        setPhase('idle')
        setSearchQuery('')
        setMatches([])
        setCurrentMatchIndex(0)
        setLabelInput('')
        setStartPoint(null)
        setEndPoint(null)
        clearHighlights()
        clearSelection()
    }, [])

    // 激活时直接进入搜索开头阶段
    useEffect(() => {
        if (isActive) {
            setPhase('searching_start')
        } else {
            reset()
        }
    }, [isActive, reset])

    // 在页面文本中搜索
    const searchInPage = useCallback((query: string): TextMatch[] => {
        if (!query || query.length < 1) return []

        const results: TextMatch[] = []
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    const parent = node.parentElement
                    if (!parent) return NodeFilter.FILTER_REJECT

                    const tagName = parent.tagName.toLowerCase()
                    if (['script', 'style', 'noscript', 'template'].includes(tagName)) {
                        return NodeFilter.FILTER_REJECT
                    }

                    const style = window.getComputedStyle(parent)
                    if (style.display === 'none' || style.visibility === 'hidden') {
                        return NodeFilter.FILTER_REJECT
                    }

                    if (parent.closest('[data-copy-mode-ui]')) {
                        return NodeFilter.FILTER_REJECT
                    }

                    return NodeFilter.FILTER_ACCEPT
                }
            }
        )

        const lowerQuery = query.toLowerCase()
        let textNode: Text | null

        while ((textNode = walker.nextNode() as Text | null)) {
            const text = textNode.textContent || ''
            const lowerText = text.toLowerCase()
            let pos = 0

            while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
                try {
                    const range = document.createRange()
                    range.setStart(textNode, pos)
                    range.setEnd(textNode, pos + query.length)
                    const rect = range.getBoundingClientRect()

                    // 检查是否可见（不被遮挡）
                    if (isElementVisible(rect, textNode)) {
                        results.push({
                            text: text.substring(pos, pos + query.length),
                            node: textNode,
                            startOffset: pos,
                            endOffset: pos + query.length,
                            rect,
                            label: ''  // 稍后填充
                        })
                    }
                } catch (e) {
                    // 忽略
                }
                pos += 1
            }
        }

        // 生成标签
        const labels = generateLabels(results.length)
        results.forEach((match, index) => {
            match.label = labels[index]
        })

        return results
    }, [])

    // 执行搜索
    const performSearch = useCallback((query: string) => {
        const results = searchInPage(query)
        setMatches(results)
        setCurrentMatchIndex(results.length > 0 ? 0 : -1)
        setLabelInput('')
        return results
    }, [searchInPage])

    // 清除高亮
    const clearHighlights = useCallback(() => {
        document.querySelectorAll('[data-copy-mode-highlight]').forEach(el => el.remove())
        document.querySelectorAll('[data-copy-mode-label]').forEach(el => el.remove())
    }, [])

    // 清除选区
    const clearSelection = useCallback(() => {
        document.querySelectorAll('[data-copy-mode-selection]').forEach(el => el.remove())
        window.getSelection()?.removeAllRanges()
    }, [])

    // 滚动到当前匹配
    const scrollToMatch = useCallback((match: TextMatch) => {
        const rect = match.rect
        // 如果匹配项不在视口内，滚动到可见
        if (rect.top < 50 || rect.bottom > window.innerHeight - 100) {
            match.node.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
    }, [])

    // 渲染匹配高亮和标签
    const isNavigating = phase === 'navigating_start' || phase === 'navigating_end'

    useEffect(() => {
        clearHighlights()

        if (matches.length === 0) return

        matches.forEach((match, index) => {
            // 刷新 rect（可能已经滚动）
            try {
                const range = document.createRange()
                range.setStart(match.node, match.startOffset)
                range.setEnd(match.node, match.endOffset)
                match.rect = range.getBoundingClientRect()
            } catch (e) {
                return
            }

            const isCurrent = index === currentMatchIndex

            // 高亮框 - 使用青色/蓝绿色，与 Hint Mode 的黄色区分
            const highlight = document.createElement('div')
            highlight.setAttribute('data-copy-mode-highlight', 'true')
            highlight.style.cssText = `
                position: fixed;
                left: ${match.rect.left - 2}px;
                top: ${match.rect.top - 2}px;
                width: ${match.rect.width + 4}px;
                height: ${match.rect.height + 4}px;
                background: ${isCurrent ? 'rgba(6, 182, 212, 0.4)' : 'rgba(6, 182, 212, 0.15)'};
                border: ${isCurrent ? '2px solid #06b6d4' : '1px solid rgba(6, 182, 212, 0.4)'};
                border-radius: 3px;
                pointer-events: none;
                z-index: 99990;
                box-shadow: ${isCurrent ? '0 0 8px rgba(6, 182, 212, 0.5)' : 'none'};
                transition: all 0.15s ease;
            `
            document.body.appendChild(highlight)

            // 只在导航阶段显示标签
            if (isNavigating) {
                const label = document.createElement('div')
                label.setAttribute('data-copy-mode-label', 'true')
                label.style.cssText = `
                    position: fixed;
                    left: ${match.rect.left}px;
                    top: ${match.rect.top - 18}px;
                    background: ${isCurrent ? '#0891b2' : '#155e75'};
                    color: white;
                    padding: 1px 4px;
                    border-radius: 3px;
                    font-size: 10px;
                    font-family: monospace;
                    font-weight: bold;
                    text-transform: uppercase;
                    pointer-events: none;
                    z-index: 99991;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                    border: 1px solid ${isCurrent ? '#06b6d4' : '#0891b2'};
                `
                // 高亮已输入的部分
                if (labelInput && match.label.startsWith(labelInput)) {
                    label.innerHTML = `<span style="color: #fbbf24">${labelInput.toUpperCase()}</span>${match.label.slice(labelInput.length).toUpperCase()}`
                } else {
                    label.textContent = match.label.toUpperCase()
                }
                document.body.appendChild(label)
            }
        })

        // 滚动到当前匹配
        if (currentMatchIndex >= 0 && currentMatchIndex < matches.length) {
            scrollToMatch(matches[currentMatchIndex])
        }
    }, [matches, currentMatchIndex, clearHighlights, isNavigating, labelInput, scrollToMatch])

    // 渲染选中区域
    useEffect(() => {
        clearSelection()

        if (!startPoint || !endPoint) return

        try {
            const range = document.createRange()
            range.setStart(startPoint.match.node, startPoint.match.startOffset)
            range.setEnd(endPoint.match.node, endPoint.match.endOffset)

            const selection = window.getSelection()
            selection?.removeAllRanges()
            selection?.addRange(range)

            const rects = range.getClientRects()
            Array.from(rects).forEach(rect => {
                const highlight = document.createElement('div')
                highlight.setAttribute('data-copy-mode-selection', 'true')
                highlight.style.cssText = `
                    position: fixed;
                    left: ${rect.left}px;
                    top: ${rect.top}px;
                    width: ${rect.width}px;
                    height: ${rect.height}px;
                    background: rgba(59, 130, 246, 0.3);
                    border: 2px solid #3b82f6;
                    border-radius: 2px;
                    pointer-events: none;
                    z-index: 99991;
                `
                document.body.appendChild(highlight)
            })
        } catch (e) {
            console.error('[CopyMode] Failed to create selection:', e)
        }
    }, [startPoint, endPoint, clearSelection])

    // 复制选中的文本
    const copySelection = useCallback(async () => {
        if (!startPoint || !endPoint) return false

        try {
            const range = document.createRange()
            range.setStart(startPoint.match.node, startPoint.match.startOffset)
            range.setEnd(endPoint.match.node, endPoint.match.endOffset)

            const text = range.toString()
            await navigator.clipboard.writeText(text)

            logger.debug('[CopyMode] Copied:', text)
            return true
        } catch (e) {
            console.error('[CopyMode] Failed to copy:', e)
            return false
        }
    }, [startPoint, endPoint])

    // 选择匹配项（通过标签或索引）
    const selectMatch = useCallback((match: TextMatch) => {
        logger.debug('[CopyMode] selectMatch called, phase:', phase)
        logger.debug('[CopyMode] selectMatch - document.hasFocus():', document.hasFocus())

        if (phase === 'navigating_start') {
            logger.debug('[CopyMode] selectMatch - setting startPoint and transitioning to searching_end')
            setStartPoint({ match, position: 'start' })
            setPhase('searching_end')
            setSearchQuery('')
            setMatches([])
            setLabelInput('')
            clearHighlights()

            // 立即检查焦点
            logger.debug('[CopyMode] selectMatch - after clearHighlights, document.hasFocus():', document.hasFocus())

            // 多次尝试恢复焦点
            const tryFocus = (attempt: number) => {
                logger.debug(`[CopyMode] tryFocus attempt ${attempt}, document.hasFocus():`, document.hasFocus())

                // 如果窗口失去焦点，尝试恢复
                if (!document.hasFocus()) {
                    logger.debug('[CopyMode] Window lost focus, trying to recover...')
                    // 尝试点击 body 来恢复窗口焦点
                    window.focus()
                }

                if (inputRef.current) {
                    inputRef.current.focus()
                    logger.debug(`[CopyMode] After focus attempt ${attempt}:`, {
                        activeElement: document.activeElement,
                        isFocused: document.activeElement === inputRef.current,
                        hasFocus: document.hasFocus()
                    })
                }
            }

            // 多次尝试，覆盖不同的时机
            setTimeout(() => tryFocus(1), 0)
            setTimeout(() => tryFocus(2), 50)
            setTimeout(() => tryFocus(3), 100)
            setTimeout(() => tryFocus(4), 200)
            setTimeout(() => tryFocus(5), 500)
        } else if (phase === 'navigating_end') {
            setEndPoint({ match, position: 'end' })
            setPhase('selected')
            setLabelInput('')
            clearHighlights()
        }
    }, [phase, clearHighlights])

    // 使用 ref callback 来处理焦点 - 多次重试以应对其他组件抢焦点
    const handleInputRef = useCallback((node: HTMLInputElement | null) => {
        if (node) {
            // 保存 ref
            (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node

            // 多次尝试聚焦，以应对其他组件重新渲染抢走焦点的情况
            const focusWithRetry = (attempt: number) => {
                if (attempt > 5) return

                node.focus()

                // 检查是否真的获得了焦点
                if (document.activeElement !== node) {
                    logger.debug(`[CopyMode] Focus attempt ${attempt} failed, retrying...`)
                    setTimeout(() => focusWithRetry(attempt + 1), 50)
                } else {
                    logger.debug(`[CopyMode] Focus succeeded on attempt ${attempt} for phase:`, phase)
                }
            }

            // 立即尝试一次
            focusWithRetry(1)

            // 延迟再尝试几次，以防其他组件在之后抢焦点
            setTimeout(() => {
                if (document.activeElement !== node) {
                    logger.debug('[CopyMode] Delayed focus attempt')
                    node.focus()
                }
            }, 100)

            setTimeout(() => {
                if (document.activeElement !== node) {
                    logger.debug('[CopyMode] Final focus attempt')
                    node.focus()
                }
            }, 200)
        }
    }, [phase])


    // 键盘事件处理
    useEffect(() => {
        logger.debug('[CopyMode] keydown useEffect running, isActive:', isActive, 'phase:', phase)
        if (!isActive) return

        const handleKeyDown = (e: KeyboardEvent) => {
            logger.debug('[CopyMode] handleKeyDown called, key:', e.key, 'phase:', phase)
            // ESC 始终可以退出
            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()

                if (phase === 'searching_start' || phase === 'searching_end') {
                    if (phase === 'searching_start') {
                        // 搜索开头阶段按 ESC 直接退出
                        onClose()
                    } else {
                        // 搜索结尾阶段按 ESC 返回导航开头
                        setPhase('navigating_start')
                        setSearchQuery('')
                        setMatches([])
                    }
                } else if (phase === 'navigating_start') {
                    // 导航开头阶段按 ESC 返回搜索开头
                    setPhase('searching_start')
                    setSearchQuery('')
                    setMatches([])
                    setLabelInput('')
                    clearHighlights()
                } else if (phase === 'navigating_end') {
                    setPhase('navigating_start')
                    setEndPoint(null)
                    setSearchQuery('')
                    setLabelInput('')
                    if (startPoint) {
                        const results = performSearch(startPoint.match.text)
                        const idx = results.findIndex(m =>
                            m.node === startPoint.match.node &&
                            m.startOffset === startPoint.match.startOffset
                        )
                        setCurrentMatchIndex(idx >= 0 ? idx : 0)
                    }
                } else if (phase === 'selected') {
                    setPhase('navigating_end')
                    clearSelection()
                } else {
                    onClose()
                }
                return
            }

            // 搜索阶段
            if (phase === 'searching_start' || phase === 'searching_end') {
                logger.debug('[CopyMode] handleKeyDown in searching phase, key:', e.key, 'phase:', phase)
                if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()

                    if (matches.length > 0) {
                        if (phase === 'searching_start') {
                            setPhase('navigating_start')
                        } else {
                            setPhase('navigating_end')
                        }
                    }
                    return
                }
                // 其他键不拦截，交给后续的标签输入或导航逻辑处理
            }

            // 导航阶段
            if (phase === 'navigating_start' || phase === 'navigating_end' || phase === 'searching_end') {
                // n - 下一个匹配
                if (e.key === 'n' && !e.shiftKey) {
                    e.preventDefault()
                    e.stopPropagation()
                    setLabelInput('')  // 重置标签输入
                    if (matches.length > 0) {
                        const newIndex = (currentMatchIndex + 1) % matches.length
                        setCurrentMatchIndex(newIndex)
                    }
                    return
                }

                // N - 上一个匹配
                if (e.key === 'N' || (e.key === 'n' && e.shiftKey)) {
                    e.preventDefault()
                    e.stopPropagation()
                    setLabelInput('')
                    if (matches.length > 0) {
                        const newIndex = (currentMatchIndex - 1 + matches.length) % matches.length
                        setCurrentMatchIndex(newIndex)
                    }
                    return
                }

                // / - 重新搜索
                if (e.key === '/') {
                    e.preventDefault()
                    e.stopPropagation()
                    if (phase === 'navigating_start') {
                        setPhase('searching_start')
                    } else {
                        setPhase('searching_end')
                    }
                    setSearchQuery('')
                    setMatches([])
                    setLabelInput('')
                    clearHighlights()
                    setTimeout(() => inputRef.current?.focus(), 0)
                    return
                }

                // Enter - 确认当前位置
                if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()

                    if (currentMatchIndex >= 0 && currentMatchIndex < matches.length) {
                        selectMatch(matches[currentMatchIndex])
                    }
                    return
                }

                // 字母键 - 标签输入
                if (e.key.length === 1 && /^[a-z]$/i.test(e.key) && e.key.toLowerCase() !== 'n') {
                    e.preventDefault()
                    e.stopPropagation()

                    const newInput = labelInput + e.key.toLowerCase()

                    // 检查完全匹配
                    const exactMatch = matches.find(m => m.label === newInput)
                    if (exactMatch) {
                        setLabelInput('')
                        selectMatch(exactMatch)
                        return
                    }

                    // 检查部分匹配
                    const partialMatches = matches.filter(m => m.label.startsWith(newInput))
                    if (partialMatches.length > 0) {
                        setLabelInput(newInput)
                        // 跳转到第一个匹配
                        const firstMatchIndex = matches.findIndex(m => m.label.startsWith(newInput))
                        if (firstMatchIndex >= 0) {
                            setCurrentMatchIndex(firstMatchIndex)
                        }
                    } else {
                        // 没有匹配，重置
                        setLabelInput('')
                    }
                    return
                }

                // Backspace - 删除标签输入
                if (e.key === 'Backspace') {
                    e.preventDefault()
                    e.stopPropagation()
                    setLabelInput(prev => prev.slice(0, -1))
                    return
                }
            }

            // 选中阶段
            if (phase === 'selected') {
                if (e.key === 'y') {
                    e.preventDefault()
                    e.stopPropagation()
                    copySelection().then(success => {
                        if (success) {
                            setTimeout(() => {
                                onClose()
                            }, 300)
                        }
                    })
                    return
                }

                if (e.key === '/') {
                    e.preventDefault()
                    e.stopPropagation()
                    setPhase('searching_end')
                    setSearchQuery('')
                    setEndPoint(null)
                    clearSelection()
                    setTimeout(() => inputRef.current?.focus(), 0)
                    return
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown, true)
        return () => document.removeEventListener('keydown', handleKeyDown, true)
    }, [isActive, phase, matches, currentMatchIndex, startPoint, labelInput, onClose,
        copySelection, clearHighlights, clearSelection, performSearch, selectMatch])

    // 搜索输入变化
    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const query = e.target.value
        logger.debug('[CopyMode] handleSearchChange called, query:', query, 'phase:', phaseRef.current)
        setSearchQuery(query)

        if (query.length >= 1) {
            performSearch(query)
        } else {
            setMatches([])
            clearHighlights()
        }
    }, [performSearch, clearHighlights])

    // 阶段对应的提示文本
    const phaseHints = useMemo(() => {
        const hints: Record<CopyModePhase, { title: string; actions: React.ReactNode }> = {
            idle: { title: '', actions: null },
            ready: {
                title: 'Copy Mode',
                actions: (
                    <>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">/</kbd>
                        <span className="ml-1 text-gray-300">开始搜索</span>
                        <span className="mx-2 text-gray-500">•</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">ESC</kbd>
                        <span className="ml-1 text-gray-300">退出</span>
                    </>
                )
            },
            searching_start: {
                title: '搜索开始位置',
                actions: (
                    <>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">Enter</kbd>
                        <span className="ml-1 text-gray-300">确认</span>
                        <span className="mx-2 text-gray-500">•</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">ESC</kbd>
                        <span className="ml-1 text-gray-300">取消</span>
                    </>
                )
            },
            navigating_start: {
                title: `选择开始位置 (${currentMatchIndex + 1}/${matches.length})`,
                actions: (
                    <>
                        <span className="text-cyan-300">输入标签</span>
                        <span className="mx-1 text-gray-500">或</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">n</kbd>
                        <span className="text-gray-300">/</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">N</kbd>
                        <span className="ml-1 text-gray-300">跳转</span>
                        <span className="mx-2 text-gray-500">•</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">Enter</kbd>
                        <span className="ml-1 text-gray-300">确认</span>
                    </>
                )
            },
            searching_end: {
                title: '搜索结束位置',
                actions: (
                    <>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">Enter</kbd>
                        <span className="ml-1 text-gray-300">确认</span>
                        <span className="mx-2 text-gray-500">•</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">ESC</kbd>
                        <span className="ml-1 text-gray-300">返回</span>
                    </>
                )
            },
            navigating_end: {
                title: `选择结束位置 (${currentMatchIndex + 1}/${matches.length})`,
                actions: (
                    <>
                        <span className="text-cyan-300">输入标签</span>
                        <span className="mx-1 text-gray-500">或</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">n</kbd>
                        <span className="text-gray-300">/</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">N</kbd>
                        <span className="ml-1 text-gray-300">跳转</span>
                        <span className="mx-2 text-gray-500">•</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">Enter</kbd>
                        <span className="ml-1 text-gray-300">确认</span>
                    </>
                )
            },
            selected: {
                title: '已选中文本',
                actions: (
                    <>
                        <kbd className="px-1.5 py-0.5 bg-green-600 rounded text-xs font-bold">y</kbd>
                        <span className="ml-1 text-green-300 font-bold">复制</span>
                        <span className="mx-2 text-gray-500">•</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">/</kbd>
                        <span className="ml-1 text-gray-300">重新选择</span>
                        <span className="mx-2 text-gray-500">•</span>
                        <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-xs">ESC</kbd>
                        <span className="ml-1 text-gray-300">取消</span>
                    </>
                )
            }
        }
        return hints
    }, [currentMatchIndex, matches.length])

    const currentHint = phaseHints[phase]

    if (!isActive || phase === 'idle') return null

    const isSearching = phase === 'searching_start' || phase === 'searching_end'

    return ReactDOM.createPortal(
        <div data-copy-mode-ui="true">
            {/* 半透明遮罩 - 不捕获事件，避免抢夺焦点 */}
            <div
                className="fixed inset-0 bg-black/5 z-[99985] pointer-events-none"
            />

            {/* 底部状态栏（包含搜索输入） */}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[99999] px-4 py-3 bg-gray-800/95 text-white rounded-lg shadow-lg min-w-[500px]">
                <div className="flex items-center gap-3">
                    {/* 状态标题 */}
                    <span className="font-bold text-cyan-400 whitespace-nowrap">{currentHint.title}</span>

                    {/* 搜索输入框（紧凑型，在状态栏内） */}
                    {isSearching && (
                        <>
                            <span className="text-gray-500">|</span>
                            <div className="flex items-center gap-2 flex-1">
                                <span className="text-cyan-400">/</span>
                                <input
                                    key={phase}
                                    ref={handleInputRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={handleSearchChange}
                                    onInput={(e) => {
                                        logger.debug('[CopyMode] onInput triggered, value:', (e.target as HTMLInputElement).value)
                                    }}
                                    onKeyUp={(e) => {
                                        logger.debug('[CopyMode] onKeyUp triggered, key:', e.key, 'input value:', (e.target as HTMLInputElement).value)
                                    }}
                                    onBlur={(e) => {
                                        // 当焦点丢失时，立即重新聚焦
                                        // 使用 phaseRef 获取最新的 phase 值，避免闭包陈旧值问题
                                        logger.debug('[CopyMode] onBlur triggered, current phase:', phaseRef.current)
                                        const tryRefocus = () => {
                                            const currentPhase = phaseRef.current
                                            if (inputRef.current && (currentPhase === 'searching_start' || currentPhase === 'searching_end')) {
                                                logger.debug('[CopyMode] Attempting refocus for phase:', currentPhase)
                                                inputRef.current.focus()
                                            }
                                        }
                                        // 多次尝试重新聚焦
                                        setTimeout(tryRefocus, 0)
                                        setTimeout(tryRefocus, 50)
                                        setTimeout(tryRefocus, 100)
                                        setTimeout(tryRefocus, 200)
                                    }}
                                    className="flex-1 bg-gray-700/50 text-white px-2 py-1 rounded border border-gray-600 focus:border-cyan-500 focus:outline-none font-mono text-sm"
                                    placeholder={phase === 'searching_start' ? '开始位置...' : '结束位置...'}
                                    autoFocus
                                />
                                {matches.length > 0 && (
                                    <span className="text-cyan-400 text-sm whitespace-nowrap">
                                        {matches.length} 个匹配
                                    </span>
                                )}
                            </div>
                        </>
                    )}

                    {/* 标签输入显示 */}
                    {isNavigating && labelInput && (
                        <>
                            <span className="text-gray-500">|</span>
                            <span className="font-mono text-cyan-400 font-bold">{labelInput.toUpperCase()}</span>
                        </>
                    )}

                    {/* 操作提示 */}
                    {!isSearching && (
                        <>
                            <span className="mx-1 text-gray-500">|</span>
                            <div className="flex items-center text-sm">
                                {currentHint.actions}
                            </div>
                        </>
                    )}
                </div>

                {/* 搜索阶段的操作提示 */}
                {isSearching && (
                    <div className="flex items-center text-sm mt-2 pt-2 border-t border-gray-700">
                        {currentHint.actions}
                    </div>
                )}
            </div>

            {/* 开始位置标记 */}
            {startPoint && (
                <div
                    className="fixed z-[99992] pointer-events-none"
                    style={{
                        left: startPoint.match.rect.left - 6,
                        top: startPoint.match.rect.top - 6,
                    }}
                >
                    <div className="w-4 h-4 bg-green-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center text-[8px] font-bold text-white">
                        S
                    </div>
                </div>
            )}
        </div>,
        document.body
    )
}

export default CopyMode
