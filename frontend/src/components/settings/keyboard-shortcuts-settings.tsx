'use client'
import { logger } from '@/lib/logger';

/**
 * 快捷键配置组件
 * 在系统设置中显示和配置快捷键
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react'
import {
    Keyboard, Zap, Clock, MousePointerClick,
    ChevronDown, ChevronUp, Save, Check, Info, Edit2, X, RotateCcw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { systemConfigService } from '@/services/system-config.service'
import { useKeyboard } from '@/context/keyboard'
import type { Keybinding, ChordGroup, CustomKeybinding } from '@/context/keyboard'
import { toast } from 'sonner'

interface KeyboardShortcutsConfig {
    chordMode: 'visual' | 'vscode'
    chordTimeout: number
    holdThreshold: number
    customBindings: CustomKeybinding[]
}

const DEFAULT_CONFIG: KeyboardShortcutsConfig = {
    chordMode: 'visual',
    chordTimeout: 2000,
    holdThreshold: 1000,
    customBindings: []
}

interface KeyboardShortcutsSettingsProps {
    className?: string
}

// 将 KeyPress 格式化为显示字符串
function formatKeyPress(key: string, modifiers?: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }): string {
    const parts: string[] = []
    if (modifiers?.meta) parts.push('⌘')
    if (modifiers?.ctrl) parts.push('Ctrl')
    if (modifiers?.alt) parts.push('⌥')
    if (modifiers?.shift) parts.push('⇧')
    parts.push(key.toUpperCase())
    return parts.join(' ')
}

// 解析快捷键字符串为 key 和 modifiers
function parseKeyString(keyStr: string): { key: string; modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } } {
    const parts = keyStr.split(' ').map(p => p.trim()).filter(Boolean)
    const modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}
    let key = ''

    for (const part of parts) {
        if (part === '⌘') modifiers.meta = true
        else if (part === 'Ctrl') modifiers.ctrl = true
        else if (part === '⌥') modifiers.alt = true
        else if (part === '⇧') modifiers.shift = true
        else key = part.toLowerCase()
    }

    return { key, modifiers }
}

// 快捷键编辑对话框
function KeybindingEditor({
    shortcutId,
    shortcutName,
    currentKey,
    onSave,
    onCancel,
    onReset
}: {
    shortcutId: string
    shortcutName: string
    currentKey: string
    onSave: (id: string, key: string, modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }) => void
    onCancel: () => void
    onReset: (id: string) => void
}) {
    const [recording, setRecording] = useState(false)
    const [newKey, setNewKey] = useState(currentKey)
    const [parsedKey, setParsedKey] = useState(parseKeyString(currentKey))

    useEffect(() => {
        if (!recording) return

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopPropagation()

            const modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}
            if (e.metaKey) modifiers.meta = true
            if (e.ctrlKey) modifiers.ctrl = true
            if (e.altKey) modifiers.alt = true
            if (e.shiftKey) modifiers.shift = true

            // 不记录单独的修饰键
            if (!['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
                const key = e.key.toLowerCase()
                const display = formatKeyPress(key, modifiers)
                setNewKey(display)
                setParsedKey({ key, modifiers })
                setRecording(false)
            }
        }

        document.addEventListener('keydown', handleKeyDown, true)
        return () => document.removeEventListener('keydown', handleKeyDown, true)
    }, [recording])

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" onClick={onCancel}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-96" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
                    编辑快捷键
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {shortcutName}
                </p>

                <div
                    onClick={() => setRecording(true)}
                    className={cn(
                        "p-4 rounded-lg border-2 text-center cursor-pointer transition-colors mb-4",
                        recording
                            ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
                            : "border-gray-300 dark:border-gray-600 hover:border-gray-400"
                    )}
                >
                    {recording ? (
                        <span className="text-primary-600 dark:text-primary-400 animate-pulse">
                            请按下新的快捷键组合...
                        </span>
                    ) : (
                        <kbd className="px-3 py-1.5 text-lg font-mono bg-gray-100 dark:bg-gray-700 rounded">
                            {newKey}
                        </kbd>
                    )}
                </div>

                <div className="flex justify-between gap-3">
                    <button
                        onClick={() => onReset(shortcutId)}
                        className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 flex items-center gap-1"
                    >
                        <RotateCcw className="h-4 w-4" />
                        恢复默认
                    </button>
                    <div className="flex gap-3">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400"
                        >
                            取消
                        </button>
                        <button
                            onClick={() => onSave(shortcutId, parsedKey.key, parsedKey.modifiers)}
                            className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                        >
                            保存
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export function KeyboardShortcutsSettings({ className }: KeyboardShortcutsSettingsProps) {
    const {
        reloadConfig,
        enabled: keyboardEnabled,
        setEnabled: setKeyboardEnabled,
        getKeybindings,
        getChordGroups,
        config: keyboardConfig
    } = useKeyboard()

    const [enabled, setEnabled] = useState(true)
    const [config, setConfig] = useState<KeyboardShortcutsConfig>(DEFAULT_CONFIG)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [hasChanges, setHasChanges] = useState(false)
    const [saveSuccess, setSaveSuccess] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)
    const [editingShortcut, setEditingShortcut] = useState<{ id: string; name: string; key: string } | null>(null)

    // 获取当前的快捷键和分组
    const keybindings = useMemo(() => getKeybindings(), [getKeybindings])
    const chordGroups = useMemo(() => getChordGroups(), [getChordGroups])

    // 获取单键快捷键（非组合）
    const singleKeybindings = useMemo(() =>
        keybindings.filter(kb => !kb.chordGroupId && kb.key),
        [keybindings]
    )

    // 按分组整理组合快捷键
    const chordBindingsByGroup = useMemo(() => {
        const map = new Map<string, Keybinding[]>()
        for (const group of chordGroups) {
            const bindings = keybindings.filter(kb => kb.chordGroupId === group.id)
            map.set(group.id, bindings)
        }
        return map
    }, [keybindings, chordGroups])

    // 加载配置
    useEffect(() => {
        loadConfig()
    }, [])

    // 同步 keyboardEnabled 状态
    useEffect(() => {
        setEnabled(keyboardEnabled)
    }, [keyboardEnabled])

    const loadConfig = async () => {
        try {
            setLoading(true)

            // 加载启用状态
            const enabledConfig = await systemConfigService.getConfigByKey('keyboard-shortcuts-enabled')
            const value = enabledConfig?.current_value ?? enabledConfig?.default_value
            setEnabled(value === true || value === 'true')

            // 加载快捷键配置
            const shortcutsConfig = await systemConfigService.getConfigByKey('keyboard-shortcuts')
            const rawValue = shortcutsConfig?.current_value ?? shortcutsConfig?.default_value
            if (rawValue && typeof rawValue === 'object') {
                setConfig(rawValue as KeyboardShortcutsConfig)
            }
        } catch (error) {
            console.error('Failed to load keyboard settings:', error)
        } finally {
            setLoading(false)
        }
    }

    const saveConfig = async () => {
        try {
            setSaving(true)

            // 保存启用状态
            await systemConfigService.updateConfigValue('keyboard-shortcuts-enabled', enabled)

            // 保存快捷键配置
            await systemConfigService.updateConfigValue('keyboard-shortcuts', config)

            setHasChanges(false)
            setSaveSuccess(true)
            setTimeout(() => setSaveSuccess(false), 2000)

            // 直接更新键盘系统状态（立即生效）
            setKeyboardEnabled(enabled)

            // 重新加载完整配置
            await reloadConfig()

        } catch (error) {
            console.error('Failed to save keyboard settings:', error)
            toast.error('保存失败，请重试')
        } finally {
            setSaving(false)
        }
    }

    const updateConfig = useCallback(<K extends keyof KeyboardShortcutsConfig>(
        key: K,
        value: KeyboardShortcutsConfig[K]
    ) => {
        setConfig(prev => ({ ...prev, [key]: value }))
        setHasChanges(true)
    }, [])

    const updateEnabled = useCallback((value: boolean) => {
        setEnabled(value)
        setHasChanges(true)
    }, [])

    // 获取快捷键的显示键（考虑自定义绑定）
    const getDisplayKey = useCallback((binding: Keybinding): string => {
        const custom = config.customBindings?.find(cb => cb.originalId === binding.id)
        if (custom && custom.key) {
            return formatKeyPress(custom.key, custom.modifiers)
        }
        if (binding.chordSuffix) {
            return binding.chordSuffix.key.toUpperCase()
        }
        if (binding.key) {
            return formatKeyPress(binding.key, binding.modifiers)
        }
        return ''
    }, [config.customBindings])

    // 获取组合分组的显示前缀
    const getGroupDisplayPrefix = useCallback((group: ChordGroup): string => {
        return formatKeyPress(group.prefix.key, group.prefix.modifiers)
    }, [])

    const handleEditShortcut = (id: string, name: string, currentKey: string) => {
        setEditingShortcut({ id, name, key: currentKey })
    }

    const handleSaveShortcut = (id: string, key: string, modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }) => {
        logger.debug('Save shortcut:', id, key, modifiers)

        // 更新 customBindings
        const newBindings = [...(config.customBindings || [])]
        const existingIndex = newBindings.findIndex(cb => cb.originalId === id)

        const newBinding: CustomKeybinding = {
            originalId: id,
            key,
            modifiers,
            enabled: true
        }

        if (existingIndex >= 0) {
            newBindings[existingIndex] = newBinding
        } else {
            newBindings.push(newBinding)
        }

        setConfig(prev => ({ ...prev, customBindings: newBindings }))
        setEditingShortcut(null)
        setHasChanges(true)
    }

    const handleResetShortcut = (id: string) => {
        // 从 customBindings 中移除该快捷键的自定义
        const newBindings = (config.customBindings || []).filter(cb => cb.originalId !== id)
        setConfig(prev => ({ ...prev, customBindings: newBindings }))
        setEditingShortcut(null)
        setHasChanges(true)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-3 border-primary-500 border-t-transparent" />
            </div>
        )
    }

    return (
        <div className={cn("rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden", className)}>
            {/* 折叠面板头部 */}
            <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    <Keyboard className="h-5 w-5 text-primary-600" />
                    <div>
                        <h3 className="font-medium text-gray-900 dark:text-white">
                            快捷键设置
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            自定义键盘快捷键和组合键行为
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* 全局开关 */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            updateEnabled(!enabled)
                        }}
                        className={cn(
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                            enabled ? "bg-primary-600" : "bg-gray-300 dark:bg-gray-600"
                        )}
                    >
                        <span
                            className={cn(
                                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                                enabled ? "translate-x-6" : "translate-x-1"
                            )}
                        />
                    </button>

                    {/* 展开/收起图标 */}
                    {isExpanded ? (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                    ) : (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                    )}
                </div>
            </div>

            {/* 折叠内容 */}
            {isExpanded && (
                <div className="border-t border-gray-200 dark:border-gray-700 p-4 space-y-6">
                    {/* 保存按钮 */}
                    {hasChanges && (
                        <div className="flex justify-end">
                            <button
                                onClick={saveConfig}
                                disabled={saving}
                                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                            >
                                {saving ? (
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                ) : saveSuccess ? (
                                    <Check className="h-4 w-4" />
                                ) : (
                                    <Save className="h-4 w-4" />
                                )}
                                {saveSuccess ? '已保存' : '保存更改'}
                            </button>
                        </div>
                    )}

                    {/* 组合键模式选择 */}
                    <div>
                        <h4 className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white mb-3">
                            <MousePointerClick className="h-4 w-4 text-amber-500" />
                            组合快捷键模式
                        </h4>

                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => updateConfig('chordMode', 'visual')}
                                disabled={!enabled}
                                className={cn(
                                    "relative rounded-lg border-2 p-3 text-left transition-all",
                                    !enabled && "opacity-50 cursor-not-allowed",
                                    config.chordMode === 'visual'
                                        ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
                                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                                )}
                            >
                                {config.chordMode === 'visual' && (
                                    <div className="absolute top-2 right-2">
                                        <Check className="h-4 w-4 text-primary-500" />
                                    </div>
                                )}
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-gray-900 dark:text-white text-sm">可视化模式</span>
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">推荐</span>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400">弹出面板显示可用选项</p>
                            </button>

                            <button
                                onClick={() => updateConfig('chordMode', 'vscode')}
                                disabled={!enabled}
                                className={cn(
                                    "relative rounded-lg border-2 p-3 text-left transition-all",
                                    !enabled && "opacity-50 cursor-not-allowed",
                                    config.chordMode === 'vscode'
                                        ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20"
                                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300"
                                )}
                            >
                                {config.chordMode === 'vscode' && (
                                    <div className="absolute top-2 right-2">
                                        <Check className="h-4 w-4 text-primary-500" />
                                    </div>
                                )}
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="font-medium text-gray-900 dark:text-white text-sm">VS Code 模式</span>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-gray-400">在超时前按后续键</p>
                            </button>
                        </div>
                    </div>

                    {/* 时间设置 */}
                    <div>
                        <h4 className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white mb-3">
                            <Clock className="h-4 w-4 text-blue-500" />
                            时间设置
                        </h4>

                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <span className="text-sm text-gray-700 dark:text-gray-300 w-28">组合键超时</span>
                                <input
                                    type="range"
                                    min="500"
                                    max="5000"
                                    step="100"
                                    value={config.chordTimeout}
                                    onChange={(e) => updateConfig('chordTimeout', Number(e.target.value))}
                                    disabled={!enabled}
                                    className="flex-1 disabled:opacity-50"
                                />
                                <span className="w-16 text-center text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded px-2 py-1">
                                    {config.chordTimeout}ms
                                </span>
                            </div>

                            <div className="flex items-center gap-3">
                                <span className="text-sm text-gray-700 dark:text-gray-300 w-28">长按阈值</span>
                                <input
                                    type="range"
                                    min="300"
                                    max="2000"
                                    step="100"
                                    value={config.holdThreshold}
                                    onChange={(e) => updateConfig('holdThreshold', Number(e.target.value))}
                                    disabled={!enabled}
                                    className="flex-1 disabled:opacity-50"
                                />
                                <span className="w-16 text-center text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded px-2 py-1">
                                    {config.holdThreshold}ms
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* 快捷键列表 */}
                    <div>
                        <h4 className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white mb-3">
                            <Keyboard className="h-4 w-4 text-purple-500" />
                            快捷键列表
                        </h4>

                        <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                            {/* 单键快捷键 */}
                            {singleKeybindings.map(binding => (
                                <div key={binding.id} className="px-3 py-2 flex items-center justify-between">
                                    <div className="flex-1">
                                        <div className="font-medium text-gray-900 dark:text-white">{binding.name}</div>
                                        <div className="text-xs text-gray-500">{binding.description}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <kbd className="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded">
                                            {getDisplayKey(binding)}
                                        </kbd>
                                        <button
                                            onClick={() => handleEditShortcut(binding.id, binding.name, getDisplayKey(binding))}
                                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                        >
                                            <Edit2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}

                            {/* 组合快捷键分组 */}
                            {chordGroups.map(group => (
                                <React.Fragment key={group.id}>
                                    <div className="px-3 py-2 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                                        <div className="flex-1">
                                            <div className="font-medium text-gray-900 dark:text-white">{group.name}</div>
                                            <div className="text-xs text-gray-500">{group.description}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <kbd className="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded">
                                                {getGroupDisplayPrefix(group)}
                                            </kbd>
                                            <button
                                                onClick={() => handleEditShortcut(
                                                    `chord-group-${group.id}`,
                                                    `${group.name} 前缀`,
                                                    getGroupDisplayPrefix(group)
                                                )}
                                                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                            >
                                                <Edit2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 该组的子快捷键 */}
                                    {chordBindingsByGroup.get(group.id)?.map(binding => (
                                        <div key={binding.id} className="px-3 py-2 pl-6 flex items-center justify-between">
                                            <div className="flex-1">
                                                <div className="text-gray-700 dark:text-gray-300">→ {binding.name}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <kbd className="px-2 py-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 rounded">
                                                    {getDisplayKey(binding)}
                                                </kbd>
                                                <button
                                                    onClick={() => handleEditShortcut(binding.id, binding.name, getDisplayKey(binding))}
                                                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                                >
                                                    <Edit2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>

                    {/* 提示信息 */}
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-xs">
                        <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                        <div className="text-blue-700 dark:text-blue-300">
                            <p>按 <kbd className="px-1 py-0.5 bg-blue-100 dark:bg-blue-800 rounded">⌘E</kbd> 命令面板 | <kbd className="px-1 py-0.5 bg-blue-100 dark:bg-blue-800 rounded">⌘K</kbd> 导航 | <kbd className="px-1 py-0.5 bg-blue-100 dark:bg-blue-800 rounded">⌘J</kbd> 元素标签</p>
                        </div>
                    </div>
                </div>
            )}

            {/* 快捷键编辑对话框 */}
            {editingShortcut && (
                <KeybindingEditor
                    shortcutId={editingShortcut.id}
                    shortcutName={editingShortcut.name}
                    currentKey={editingShortcut.key}
                    onSave={handleSaveShortcut}
                    onCancel={() => setEditingShortcut(null)}
                    onReset={handleResetShortcut}
                />
            )}
        </div>
    )
}
