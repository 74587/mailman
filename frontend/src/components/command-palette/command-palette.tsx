'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { X, ArrowRight, Keyboard, Search } from 'lucide-react'
import { useKeyboard } from '@/context/keyboard'
import { formatKeyPress } from '@/context/keyboard/chord-palette'
import { useHintMode } from '@/components/hint-mode/hint-mode-provider'

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

// 获取快捷键显示文本
function getShortcutKey(index: number): { key: string; alt: boolean } {
    if (index < 9) {
        return { key: String(index + 1), alt: false }
    } else {
        return { key: String(index - 8), alt: true }  // alt+1, alt+2, ...
    }
}

// 快捷键标签组件
function ShortcutBadge({ index }: { index: number }) {
    const { key, alt } = getShortcutKey(index)

    return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 min-w-[20px] justify-center">
            {alt && <span className="text-[10px] opacity-70">⌥</span>}
            {key}
        </span>
    )
}

// 高亮匹配文本
function HighlightText({ text, query }: { text: string; query: string }) {
    if (!query) return <>{text}</>

    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const index = lowerText.indexOf(lowerQuery)

    if (index === -1) return <>{text}</>

    return (
        <>
            {text.slice(0, index)}
            <span className="bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 rounded px-0.5">
                {text.slice(index, index + query.length)}
            </span>
            {text.slice(index + query.length)}
        </>
    )
}

// 简单模糊匹配：查询字符顺序出现即可（忽略大小写和空格）
function fuzzyMatch(text: string, query: string): boolean {
    const t = text.toLowerCase()
    const q = query.toLowerCase().replace(/\s+/g, '')
    let pos = 0
    for (let i = 0; i < q.length; i++) {
        const idx = t.indexOf(q[i], pos)
        if (idx === -1) return false
        pos = idx + 1
    }
    return true
}

// 全局分类注册表 - 解决事件时序问题
const globalCategoryRegistry: Map<string, ShortcutCategory> = new Map()

// 注册分类的辅助函数
export function registerPaletteCategory(category: ShortcutCategory) {
    globalCategoryRegistry.set(category.id, category)
    window.dispatchEvent(new CustomEvent('registerPaletteCategory', { detail: category }))
}

// 更新分类的辅助函数
export function updatePaletteCategory(categoryId: string, actions: ShortcutAction[]) {
    const existing = globalCategoryRegistry.get(categoryId)
    if (existing) {
        globalCategoryRegistry.set(categoryId, { ...existing, actions })
    }
    window.dispatchEvent(new CustomEvent('updatePaletteCategory', { detail: { categoryId, actions } }))
}

export function CommandPalette() {
    // 获取键盘快捷键配置
    const { getKeybindings, config } = useKeyboard()

    // 获取 Hint Mode 状态
    const { isActive: isHintModeActive } = useHintMode()

    // 内部状态管理
    const [isPaletteOpen, setIsPaletteOpen] = useState(false)
    const [categories, setCategories] = useState<ShortcutCategory[]>([])
    const [selectedCategoryIndex, setSelectedCategoryIndex] = useState<number | null>(null)
    const [step, setStep] = useState<'category' | 'action'>('category')
    const [searchQuery, setSearchQuery] = useState('')
    // Highlighted index for navigating candidates with Tab/Shift+Tab
    const [highlightedIndex, setHighlightedIndex] = useState(0)

    // 获取命令面板的快捷键显示文本
    const commandPaletteShortcut = useMemo(() => {
        const bindings = getKeybindings()
        const binding = bindings.find(b => b.command === 'command-palette.toggle')

        // 检查是否有自定义快捷键
        const customBinding = config.customBindings?.find(cb => cb.originalId === binding?.id)
        if (customBinding?.key) {
            return formatKeyPress(customBinding.key, customBinding.modifiers)
        }

        if (binding) {
            return formatKeyPress(binding.key, binding.modifiers)
        }
        return '⌘E'
    }, [getKeybindings, config.customBindings])

    // 组件挂载时，从全局注册表加载已注册的分类
    useEffect(() => {
        // 加载已注册的分类
        const existingCategories = Array.from(globalCategoryRegistry.values())
        if (existingCategories.length > 0) {
            setCategories(existingCategories)
        }
    }, [])

    // 监听 toggleCommandPalette 事件（新键盘系统）
    useEffect(() => {
        const handleToggle = () => {
            setIsPaletteOpen(prev => !prev)
        }

        window.addEventListener('toggleCommandPalette', handleToggle)
        return () => window.removeEventListener('toggleCommandPalette', handleToggle)
    }, [])

    // 监听分类注册事件
    useEffect(() => {
        const handleRegister = (event: CustomEvent<ShortcutCategory>) => {
            setCategories(prev => {
                const exists = prev.find(c => c.id === event.detail.id)
                if (exists) {
                    return prev.map(c => c.id === event.detail.id ? event.detail : c)
                }
                return [...prev, event.detail]
            })
        }

        const handleUpdate = (event: CustomEvent<{ categoryId: string; actions: ShortcutAction[] }>) => {
            setCategories(prev => prev.map(c =>
                c.id === event.detail.categoryId
                    ? { ...c, actions: event.detail.actions }
                    : c
            ))
        }

        window.addEventListener('registerPaletteCategory', handleRegister as EventListener)
        window.addEventListener('updatePaletteCategory', handleUpdate as EventListener)

        return () => {
            window.removeEventListener('registerPaletteCategory', handleRegister as EventListener)
            window.removeEventListener('updatePaletteCategory', handleUpdate as EventListener)
        }
    }, [])

    const closePalette = useCallback(() => setIsPaletteOpen(false), [])

    // 获取当前选中的分类
    const selectedCategory = selectedCategoryIndex !== null
        ? categories[selectedCategoryIndex]
        : null

    // 过滤后的分类列表
    const filteredCategories = useMemo(() => {
        if (!searchQuery || step === 'action') return categories
        return categories.filter(cat =>
            fuzzyMatch(cat.name, searchQuery)
        )
    }, [categories, searchQuery, step])

    // 过滤后的操作列表
    const filteredActions = useMemo(() => {
        if (!selectedCategory) return []
        if (!searchQuery) return selectedCategory.actions
        return selectedCategory.actions.filter(action =>
            fuzzyMatch(action.name, searchQuery)
        )
    }, [selectedCategory, searchQuery])

    // 重置状态
    const resetState = useCallback(() => {
        setSelectedCategoryIndex(null)
        setStep('category')
        setSearchQuery('')
    }, [])

    // 面板关闭时重置状态
    useEffect(() => {
        if (!isPaletteOpen) {
            resetState()
        }
    }, [isPaletteOpen, resetState])

    // Reset highlighted index when step or list changes
    useEffect(() => {
        setHighlightedIndex(0)
    }, [step, filteredCategories, filteredActions])

    // 处理分类选择
    const handleCategorySelect = useCallback((index: number) => {
        // 使用过滤后的列表进行选择
        const targetCategories = searchQuery && step === 'category' ? filteredCategories : categories
        if (index >= 0 && index < targetCategories.length) {
            const actualIndex = categories.findIndex(c => c.id === targetCategories[index].id)
            setSelectedCategoryIndex(actualIndex)
            setStep('action')
            setSearchQuery('') // 切换后清空搜索
        }
    }, [categories, filteredCategories, searchQuery, step])

    // 处理操作执行
    const handleActionExecute = useCallback((action: ShortcutAction) => {
        action.onExecute()
        closePalette()
    }, [closePalette])

    // 键盘事件处理
    useEffect(() => {
        if (!isPaletteOpen) return

        const handleKeyDown = (event: KeyboardEvent) => {
            // 如果 Hint Mode 激活，不处理键盘事件，让 Hint Mode 优先处理
            if (isHintModeActive) {
                return
            }

            // Tab navigation for candidates
            if (event.key === 'Tab') {
                event.preventDefault()
                const listLength = step === 'category'
                    ? (searchQuery ? filteredCategories.length : categories.length)
                    : (searchQuery ? filteredActions.length : (selectedCategory?.actions?.length || 0))
                if (listLength === 0) return
                setHighlightedIndex(prev => {
                    const delta = event.shiftKey ? -1 : 1
                    let next = (prev + delta) % listLength
                    if (next < 0) next += listLength
                    return next
                })
                return
            }

            // Arrow key navigation (up/down)
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                const listLength = step === 'category'
                    ? (searchQuery ? filteredCategories.length : categories.length)
                    : (searchQuery ? filteredActions.length : (selectedCategory?.actions?.length || 0))
                if (listLength === 0) return
                setHighlightedIndex(prev => {
                    const delta = event.key === 'ArrowDown' ? 1 : -1
                    let next = (prev + delta) % listLength
                    if (next < 0) next += listLength
                    return next
                })
                return
            }

            // 数字键选择 (仅当没有搜索内容或正在搜索时)
            const keyNum = parseInt(event.key)
            if (!isNaN(keyNum) && keyNum >= 1 && keyNum <= 9) {
                // 如果正在输入搜索内容，不拦截数字键
                if (searchQuery && !event.altKey) {
                    return
                }

                event.preventDefault()
                event.stopPropagation()

                const index = event.altKey ? keyNum + 8 : keyNum - 1

                if (step === 'category') {
                    handleCategorySelect(index)
                } else if (step === 'action') {
                    const actions = searchQuery ? filteredActions : (selectedCategory?.actions || [])
                    if (index < actions.length) {
                        handleActionExecute(actions[index])
                    }
                }
                return
            }

            // 0 键 (10号位置)
            if (event.key === '0') {
                if (searchQuery && !event.altKey) return

                event.preventDefault()
                event.stopPropagation()

                const index = event.altKey ? 17 : 9

                if (step === 'action') {
                    const actions = searchQuery ? filteredActions : (selectedCategory?.actions || [])
                    if (index < actions.length) {
                        handleActionExecute(actions[index])
                    }
                }
                return
            }

            // ESC 键处理 - 二级返回一级，一级关闭面板
            if (event.key === 'Escape') {
                event.preventDefault()
                if (step === 'action') {
                    // 如果在二级操作步骤，返回一级分类
                    setStep('category')
                    setSelectedCategoryIndex(null)
                    setSearchQuery('')
                } else {
                    // 如果在一级分类，关闭面板
                    closePalette()
                }
                return
            }

            // Backspace 处理 - 优先删除搜索字符，其次返回上一级
            if (event.key === 'Backspace') {
                event.preventDefault()
                if (searchQuery) {
                    // 如果有搜索内容，删除最后一个字符
                    setSearchQuery(prev => prev.slice(0, -1))
                } else if (step === 'action') {
                    // 如果没有搜索内容且在操作步骤，返回上一级
                    setStep('category')
                    setSelectedCategoryIndex(null)
                }
                return
            }

            // Enter 键或空格键 - 选择当前高亮项
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (step === 'category') {
                    const targetCategories = searchQuery ? filteredCategories : categories
                    if (highlightedIndex < targetCategories.length) {
                        handleCategorySelect(highlightedIndex)
                    }
                } else if (step === 'action') {
                    const actions = searchQuery ? filteredActions : (selectedCategory?.actions || [])
                    if (highlightedIndex < actions.length) {
                        handleActionExecute(actions[highlightedIndex])
                    }
                }
                return
            }

            // 阻止大部分带有 CMD/Ctrl 修饰键的按键（防止触发浏览器默认行为）
            // 只允许 CMD+E （用于关闭面板的快捷键）通过
            if ((event.metaKey || event.ctrlKey) && event.key.length === 1) {
                // 允许 CMD+E 通过，用于关闭命令面板
                if (event.key.toLowerCase() === 'e') {
                    // 不阻止，让事件继续传播到 keyboard-provider 处理
                    return
                }
                // 阻止其他 CMD/Ctrl 组合键（如 CMD+U、CMD+I 等）
                event.preventDefault()
                event.stopPropagation()
                return
            }

            // 字母和中文输入 - 添加到搜索
            if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
                // 忽略数字键（已在上面处理）
                if (/[0-9]/.test(event.key)) return

                setSearchQuery(prev => prev + event.key)
                event.preventDefault()
            }
        }

        document.addEventListener('keydown', handleKeyDown, true)
        return () => document.removeEventListener('keydown', handleKeyDown, true)
    }, [isPaletteOpen, step, categories, selectedCategory, filteredCategories, filteredActions, searchQuery, handleCategorySelect, handleActionExecute, isHintModeActive])

    if (!isPaletteOpen) return null

    // 显示的分类列表
    const displayCategories = step === 'category' && searchQuery ? filteredCategories : categories
    // 显示的操作列表
    const displayActions = step === 'action' ? (searchQuery ? filteredActions : (selectedCategory?.actions || [])) : []

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            onClick={(e) => {
                if (e.target === e.currentTarget) closePalette()
            }}
        >
            {/* 背景遮罩 */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

            {/* 主面板 */}
            <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 w-[600px] max-h-[500px] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* 标题栏 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                    <div className="flex items-center gap-2">
                        <Keyboard className="h-5 w-5 text-primary-600" />
                        <span className="font-semibold text-gray-900 dark:text-white">快捷操作</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">
                            {commandPaletteShortcut}
                        </span>
                    </div>

                    {/* 搜索指示器 */}
                    {searchQuery && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-primary-50 dark:bg-primary-900/30 rounded-full">
                            <Search className="h-3 w-3 text-primary-600" />
                            <span className="text-sm text-primary-700 dark:text-primary-300 font-medium">
                                {searchQuery}
                            </span>
                            <button
                                onClick={() => setSearchQuery('')}
                                className="p-0.5 rounded hover:bg-primary-100 dark:hover:bg-primary-800"
                            >
                                <X className="h-3 w-3 text-primary-600" />
                            </button>
                        </div>
                    )}

                    <button
                        onClick={closePalette}
                        className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* 内容区域 */}
                <div className="flex h-[400px]">
                    {/* 左侧：分类列表 */}
                    <div className="w-[200px] border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
                        <div className="p-2">
                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2 py-1 mb-1">
                                一级分类
                                {step === 'category' && searchQuery && (
                                    <span className="text-primary-600 ml-1">
                                        ({filteredCategories.length}/{categories.length})
                                    </span>
                                )}
                            </div>
                            {displayCategories.length === 0 ? (
                                <div className="text-center py-8 text-gray-400 text-sm">
                                    {searchQuery ? '无匹配分类' : '暂无分类'}
                                </div>
                            ) : (
                                displayCategories.map((category, index) => {
                                    const Icon = category.icon
                                    const isSelected = selectedCategoryIndex === categories.findIndex(c => c.id === category.id)

                                    return (
                                        <button
                                            key={category.id}
                                            onClick={() => handleCategorySelect(index)}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors",
                                                isSelected
                                                    ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                                                    : highlightedIndex === index && step === 'category'
                                                        ? "bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 ring-1 ring-primary-300 dark:ring-primary-700"
                                                        : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                                            )}
                                        >
                                            <ShortcutBadge index={index} />
                                            {Icon && <Icon className="h-4 w-4 shrink-0" />}
                                            <span className="text-sm font-medium truncate flex-1">
                                                <HighlightText text={category.name} query={step === 'category' ? searchQuery : ''} />
                                            </span>
                                            {isSelected && <ArrowRight className="h-3 w-3 shrink-0" />}
                                        </button>
                                    )
                                })
                            )}
                        </div>
                    </div>

                    {/* 右侧：操作列表 */}
                    <div className="flex-1 overflow-y-auto">
                        <div className="p-2">
                            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2 py-1 mb-1">
                                {selectedCategory ? selectedCategory.name : '快捷操作'}
                                {step === 'action' && searchQuery && selectedCategory && (
                                    <span className="text-primary-600 ml-1">
                                        ({filteredActions.length}/{selectedCategory.actions.length})
                                    </span>
                                )}
                            </div>

                            {!selectedCategory ? (
                                <div className="flex flex-col items-center justify-center h-[300px] text-gray-400">
                                    <Keyboard className="h-12 w-12 mb-3 opacity-50" />
                                    <p className="text-sm">选择左侧分类查看操作</p>
                                    <p className="text-xs mt-1">按数字键快速选择，或直接输入搜索</p>
                                </div>
                            ) : displayActions.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-[300px] text-gray-400">
                                    <p className="text-sm">{searchQuery ? '无匹配操作' : '暂无可用操作'}</p>
                                </div>
                            ) : (
                                displayActions.map((action, index) => {
                                    const Icon = action.icon

                                    return (
                                        <button
                                            key={action.id}
                                            onClick={() => handleActionExecute(action)}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors",
                                                highlightedIndex === index && step === 'action'
                                                    ? "bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 ring-1 ring-primary-300 dark:ring-primary-700"
                                                    : "hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                                            )}
                                        >
                                            <ShortcutBadge index={index} />
                                            {Icon && <Icon className="h-4 w-4 shrink-0" />}
                                            <span className="text-sm truncate flex-1">
                                                <HighlightText text={action.name} query={step === 'action' ? searchQuery : ''} />
                                            </span>
                                        </button>
                                    )
                                })
                            )}
                        </div>
                    </div>
                </div>

                {/* 底部提示 */}
                <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 flex items-center gap-4">
                    <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px]">1-9</kbd>
                        选择
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px]">↑↓</kbd>
                        切换
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px]">输入</kbd>
                        搜索
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px]">↵</kbd>
                        确认
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px]">⌫</kbd>
                        返回
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px]">Esc</kbd>
                        关闭
                    </span>
                </div>
            </div>
        </div>
    )
}
