'use client'

/**
 * 组合快捷键面板
 * 在可视化模式下显示可用的组合快捷键选项
 */

import React from 'react'
import { cn } from '@/lib/utils'
import { Keyboard } from 'lucide-react'
import type { ChordPaletteState, ChordGroup, Keybinding, KeyPress } from './types'

interface ChordPaletteProps {
    state: ChordPaletteState
    onClose: () => void
    onSelectBinding: (binding: Keybinding) => void
    onSelectGroup: (group: ChordGroup) => void
}

export function ChordPalette({
    state,
    onClose,
    onSelectBinding,
    onSelectGroup
}: ChordPaletteProps) {
    if (!state.isOpen) return null

    return (
        <>
            {/* 背景遮罩 */}
            <div
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[9999]"
                onClick={onClose}
            />

            {/* 面板 */}
            <div className="fixed inset-0 z-[9999] flex items-center justify-center">
                <div className={cn(
                    "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl",
                    "overflow-hidden animate-in fade-in zoom-in-95 duration-200 w-[600px] max-w-[calc(100vw-2rem)]"
                )}>
                    {/* 头部 */}
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <Keyboard className="h-5 w-5 text-primary-500" />
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            组合快捷键
                        </span>
                        {state.activeGroup && (
                            <>
                                <span className="text-gray-400 dark:text-gray-500">·</span>
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                    {state.activeGroup.name}
                                </span>
                            </>
                        )}

                        <div className="ml-auto flex items-center gap-2">
                            {state.isHoldMode && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                    松开释放
                                </span>
                            )}
                            {!state.isHoldMode && (
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    按 ESC 关闭
                                </span>
                            )}
                        </div>
                    </div>

                    {/* 内容区 */}
                    <div className="flex min-h-48 max-h-80">
                        {/* 左侧：组合分组列表（仅当有多个分组时显示） */}
                        {state.availableGroups.length > 1 && (
                            <div className="w-44 border-r border-gray-200 dark:border-gray-700 overflow-y-auto bg-gray-50/50 dark:bg-gray-800/30">
                                <div className="p-2 space-y-1">
                                    {state.availableGroups.map((group) => (
                                        <button
                                            key={group.id}
                                            onClick={() => onSelectGroup(group)}
                                            className={cn(
                                                "w-full flex items-center gap-2 px-3 py-2.5 rounded-lg",
                                                "text-sm text-left transition-colors",
                                                group.id === state.activeGroup?.id
                                                    ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                                                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200"
                                            )}
                                        >
                                            {group.icon && (
                                                <group.icon className="h-4 w-4 flex-shrink-0" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium truncate">
                                                    {group.name}
                                                </div>
                                            </div>
                                            <KeyBadge keyPress={group.prefix} size="sm" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 右侧：当前分组的快捷键列表 */}
                        <div className="flex-1 overflow-y-auto">
                            <div className="p-2 space-y-1">
                                {state.availableBindings.length === 0 ? (
                                    <div className="flex items-center justify-center h-40 text-gray-500 dark:text-gray-400 text-sm">
                                        此分组暂无可用快捷键
                                    </div>
                                ) : (
                                    state.availableBindings.map((binding) => (
                                        <button
                                            key={binding.id}
                                            onClick={() => onSelectBinding(binding)}
                                            className={cn(
                                                "w-full flex items-center gap-3 px-4 py-3 rounded-lg",
                                                "text-left transition-colors",
                                                "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                                            )}
                                        >
                                            {binding.icon && (
                                                <binding.icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-sm">
                                                    {binding.name}
                                                </div>
                                                {binding.description && (
                                                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                                        {binding.description}
                                                    </div>
                                                )}
                                            </div>
                                            {binding.chordSuffix && (
                                                <KeyBadge keyPress={binding.chordSuffix} />
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 底部提示 */}
                    <div className="px-4 py-2.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                            {state.availableGroups.length > 1 && (
                                <span className="flex items-center gap-1.5">
                                    <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px] font-mono">Tab</kbd>
                                    切换分组
                                </span>
                            )}
                            <span className="flex items-center gap-1.5">
                                <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-[10px] font-mono">ESC</kbd>
                                关闭
                            </span>
                            <span className="flex items-center gap-1">
                                按快捷键直接执行
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

/**
 * 快捷键徽章组件
 */
export function KeyBadge({
    keyPress,
    size = 'md'
}: {
    keyPress: KeyPress
    size?: 'sm' | 'md'
}) {
    const parts: string[] = []
    const m = keyPress.modifiers ?? {}

    if (m.meta) parts.push('⌘')
    if (m.ctrl) parts.push('⌃')
    if (m.alt) parts.push('⌥')
    if (m.shift) parts.push('⇧')

    // 格式化键名
    let keyName = keyPress.key
    if (keyName.length === 1) {
        keyName = keyName.toUpperCase()
    } else {
        // 特殊键名处理
        const keyMap: Record<string, string> = {
            'escape': 'ESC',
            'enter': '↵',
            'tab': 'Tab',
            'backspace': '⌫',
            'delete': '⌦',
            'arrowup': '↑',
            'arrowdown': '↓',
            'arrowleft': '←',
            'arrowright': '→',
            'space': '␣'
        }
        keyName = keyMap[keyName.toLowerCase()] || keyName
    }
    parts.push(keyName)

    return (
        <span className={cn(
            "inline-flex items-center gap-0.5 font-mono",
            "bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1.5",
            size === 'sm' ? "text-[10px] py-0.5" : "text-xs py-1"
        )}>
            {parts.map((part, i) => (
                <span key={i}>{part}</span>
            ))}
        </span>
    )
}

/**
 * 格式化 KeyPress 为字符串（简单版本）
 */
export function formatKeyPress(key?: string, modifiers?: KeyPress['modifiers']): string {
    const parts: string[] = []
    const m = modifiers ?? {}

    if (m.meta) parts.push('⌘')
    if (m.ctrl) parts.push('⌃')
    if (m.alt) parts.push('⌥')
    if (m.shift) parts.push('⇧')
    if (key) {
        parts.push(key.length === 1 ? key.toUpperCase() : key)
    }

    return parts.join('')
}

/**
 * 格式化快捷键为字符串
 */
export function formatKeybinding(binding: Keybinding): string {
    if (binding.chordSuffix) {
        // 组合键需要显示前缀 + 后缀
        return formatKeyPress(binding.key, binding.modifiers) + ' ' +
            formatKeyPress(binding.chordSuffix.key, binding.chordSuffix.modifiers)
    }

    return formatKeyPress(binding.key, binding.modifiers)
}
