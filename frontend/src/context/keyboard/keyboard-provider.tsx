'use client'
import { logger } from '@/lib/logger';

/**
 * 键盘快捷键系统 Context Provider
 * 提供全局的快捷键注册、命令执行和上下文管理
 */

import React, {
    createContext,
    useContext,
    useEffect,
    useCallback,
    useRef,
    useState,
    ReactNode,
    useMemo
} from 'react'
import {
    Keybinding,
    Command,
    ChordGroup,
    KeyboardContext as KbContext,
    KeyboardShortcutsConfig,
    ChordPaletteState,
    ChordMode,
    DEFAULT_KEYBOARD_CONFIG
} from './types'
import { ChordResolver } from './chord-resolver'
import { KeyboardContextCollector } from './context-collector'
import { ChordPalette } from './chord-palette'
import { systemConfigService } from '@/services/system-config.service'

// ============ Context 类型定义 ============

interface KeyboardProviderValue {
    // 快捷键注册
    registerKeybinding: (binding: Keybinding) => void
    unregisterKeybinding: (id: string) => void

    // 组合分组注册
    registerChordGroup: (group: ChordGroup) => void
    unregisterChordGroup: (id: string) => void

    // 命令注册
    registerCommand: (command: Command) => void
    unregisterCommand: (id: string) => void

    // 上下文管理
    setContext: (key: string, value: unknown) => void
    removeContext: (key: string) => void

    // 配置
    config: KeyboardShortcutsConfig
    setChordMode: (mode: ChordMode) => void
    reloadConfig: () => Promise<void>

    // 快捷键是否启用
    enabled: boolean
    setEnabled: (enabled: boolean) => void

    // 获取所有数据
    getKeybindings: () => Keybinding[]
    getCommands: () => Command[]
    getChordGroups: () => ChordGroup[]

    // 执行命令
    executeCommand: (commandId: string) => void
}

// ============ Context 创建 ============

const KeyboardContextReact = createContext<KeyboardProviderValue | null>(null)

/**
 * 使用键盘快捷键系统
 */
export function useKeyboard() {
    const context = useContext(KeyboardContextReact)
    if (!context) {
        throw new Error('useKeyboard must be used within a KeyboardProvider')
    }
    return context
}

/**
 * 注册快捷键的 Hook
 */
export function useKeybinding(binding: Keybinding, deps: React.DependencyList = []) {
    const { registerKeybinding, unregisterKeybinding } = useKeyboard()

    useEffect(() => {
        registerKeybinding(binding)
        return () => unregisterKeybinding(binding.id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [binding.id, ...deps])
}

/**
 * 注册命令的 Hook
 */
export function useCommand(command: Command, deps: React.DependencyList = []) {
    const { registerCommand, unregisterCommand } = useKeyboard()

    useEffect(() => {
        registerCommand(command)
        return () => unregisterCommand(command.id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [command.id, ...deps])
}

/**
 * 设置上下文的 Hook
 */
export function useKeyboardContext(key: string, value: unknown) {
    const { setContext, removeContext } = useKeyboard()

    useEffect(() => {
        setContext(key, value)
        return () => removeContext(key)
    }, [key, value, setContext, removeContext])
}

// ============ Provider 组件 ============

interface KeyboardProviderProps {
    children: ReactNode
}

export function KeyboardProvider({ children }: KeyboardProviderProps) {
    // Resolver 和 Collector 引用
    const resolverRef = useRef(new ChordResolver())
    const collectorRef = useRef(new KeyboardContextCollector())

    // 状态
    const [enabled, setEnabledState] = useState(true)
    const [config, setConfig] = useState<KeyboardShortcutsConfig>(DEFAULT_KEYBOARD_CONFIG)
    const [chordPaletteState, setChordPaletteState] = useState<ChordPaletteState>({
        isOpen: false,
        activeGroup: null,
        availableGroups: [],
        availableBindings: [],
        isHoldMode: false,
        keyDownTime: null
    })
    const [isLoaded, setIsLoaded] = useState(false)

    // 订阅面板状态变化
    useEffect(() => {
        resolverRef.current.onStateChange(setChordPaletteState)
    }, [])

    // 加载配置
    const loadConfig = useCallback(async () => {
        try {
            // 加载启用状态
            const enabledConfig = await systemConfigService.getConfigByKey('keyboard-shortcuts-enabled')
            // 处理 current_value 可能为 null 的情况，使用 default_value
            let isEnabled = true // 默认启用
            if (enabledConfig) {
                const value = enabledConfig.current_value ?? enabledConfig.default_value
                isEnabled = value === true || value === 'true'
            }
            logger.debug('[Keyboard] Enabled:', isEnabled)
            setEnabledState(isEnabled)

            // 加载快捷键配置
            const shortcutsConfig = await systemConfigService.getConfigByKey('keyboard-shortcuts')
            let configValue = DEFAULT_KEYBOARD_CONFIG
            if (shortcutsConfig) {
                const rawValue = shortcutsConfig.current_value ?? shortcutsConfig.default_value
                if (rawValue && typeof rawValue === 'object') {
                    configValue = rawValue as KeyboardShortcutsConfig
                }
            }

            setConfig(configValue)
            resolverRef.current.setConfig({
                chordMode: configValue.chordMode,
                chordTimeout: configValue.chordTimeout,
                holdThreshold: configValue.holdThreshold
            })
            resolverRef.current.setCustomBindings(configValue.customBindings || [])

            logger.debug('[Keyboard] Config loaded:', configValue)
        } catch (error) {
            console.warn('[Keyboard] Failed to load config, using defaults:', error)
            setConfig(DEFAULT_KEYBOARD_CONFIG)
            setEnabledState(true) // 默认启用
        } finally {
            setIsLoaded(true)
        }
    }, [])

    useEffect(() => {
        loadConfig()
    }, [loadConfig])

    // 注册函数
    const registerKeybinding = useCallback((binding: Keybinding) => {
        resolverRef.current.registerKeybinding(binding)
    }, [])

    const unregisterKeybinding = useCallback((id: string) => {
        resolverRef.current.unregisterKeybinding(id)
    }, [])

    const registerChordGroup = useCallback((group: ChordGroup) => {
        resolverRef.current.registerChordGroup(group)
    }, [])

    const unregisterChordGroup = useCallback((id: string) => {
        resolverRef.current.unregisterChordGroup(id)
    }, [])

    const registerCommand = useCallback((command: Command) => {
        resolverRef.current.registerCommand(command)
    }, [])

    const unregisterCommand = useCallback((id: string) => {
        resolverRef.current.unregisterCommand(id)
    }, [])

    // 上下文管理
    const setContext = useCallback((key: string, value: unknown) => {
        collectorRef.current.setContext(key, value)
    }, [])

    const removeContext = useCallback((key: string) => {
        collectorRef.current.removeContext(key)
    }, [])

    // 配置
    const setChordMode = useCallback((mode: ChordMode) => {
        setConfig(prev => ({ ...prev, chordMode: mode }))
        resolverRef.current.setConfig({ chordMode: mode })
    }, [])

    const setEnabled = useCallback((value: boolean) => {
        setEnabledState(value)
    }, [])

    // 获取器
    const getKeybindings = useCallback(() => resolverRef.current.getAllKeybindings(), [])
    const getCommands = useCallback(() => resolverRef.current.getAllCommands(), [])
    const getChordGroups = useCallback(() => resolverRef.current.getAllChordGroups(), [])

    // 执行命令
    const executeCommand = useCallback((commandId: string) => {
        const context = collectorRef.current.collect()
        const command = resolverRef.current.getCommand(commandId)
        if (command) {
            command.handler(context)
        }
    }, [])

    // 全局键盘事件监听
    useEffect(() => {
        if (!isLoaded) return

        const handleKeyDown = (event: KeyboardEvent) => {
            // 如果快捷键被禁用，不处理
            if (!enabled) return

            const context = collectorRef.current.collect()
            context.chordPaletteOpen = chordPaletteState.isOpen

            resolverRef.current.handleKeyDown(event, context)
        }

        const handleKeyUp = (event: KeyboardEvent) => {
            if (!enabled) return
            resolverRef.current.handleKeyUp(event)
        }

        document.addEventListener('keydown', handleKeyDown, true)
        document.addEventListener('keyup', handleKeyUp, true)

        return () => {
            document.removeEventListener('keydown', handleKeyDown, true)
            document.removeEventListener('keyup', handleKeyUp, true)
        }
    }, [enabled, chordPaletteState.isOpen, isLoaded])

    // 处理组合快捷键面板的交互
    const handleChordPaletteClose = useCallback(() => {
        resolverRef.current.closePalette()
    }, [])

    const handleChordBindingSelect = useCallback((binding: Keybinding) => {
        const context = collectorRef.current.collect()
        resolverRef.current.closePalette()
        const command = resolverRef.current.getCommand(binding.command)
        command?.handler(context)
    }, [])

    const handleChordGroupSelect = useCallback((group: ChordGroup) => {
        const context = collectorRef.current.collect()
        resolverRef.current.selectGroup(group.id, context)
    }, [])

    // Context value
    const value = useMemo<KeyboardProviderValue>(() => ({
        registerKeybinding,
        unregisterKeybinding,
        registerChordGroup,
        unregisterChordGroup,
        registerCommand,
        unregisterCommand,
        setContext,
        removeContext,
        config,
        setChordMode,
        reloadConfig: loadConfig,
        enabled,
        setEnabled,
        getKeybindings,
        getCommands,
        getChordGroups,
        executeCommand
    }), [
        registerKeybinding,
        unregisterKeybinding,
        registerChordGroup,
        unregisterChordGroup,
        registerCommand,
        unregisterCommand,
        setContext,
        removeContext,
        config,
        setChordMode,
        loadConfig,
        enabled,
        setEnabled,
        getKeybindings,
        getCommands,
        getChordGroups,
        executeCommand
    ])

    return (
        <KeyboardContextReact.Provider value={value}>
            {children}

            {/* 组合快捷键面板 */}
            <ChordPalette
                state={chordPaletteState}
                onClose={handleChordPaletteClose}
                onSelectBinding={handleChordBindingSelect}
                onSelectGroup={handleChordGroupSelect}
            />
        </KeyboardContextReact.Provider>
    )
}

// 导出类型
export type { Keybinding, Command, ChordGroup, KeyboardShortcutsConfig, ChordMode }
