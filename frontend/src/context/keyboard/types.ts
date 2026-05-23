/**
 * 快捷键系统类型定义
 */

import React from 'react'

/**
 * 单个按键定义
 */
export interface KeyPress {
    key: string
    modifiers?: {
        meta?: boolean      // ⌘ (Mac) / Ctrl (Windows)
        ctrl?: boolean      // Ctrl
        alt?: boolean       // Alt/Option
        shift?: boolean     // Shift
    }
}

/**
 * 组合快捷键分组定义
 * 用于定义组合快捷键的前缀和分组信息
 */
export interface ChordGroup {
    id: string                                          // 唯一标识
    name: string                                        // 分组名称，如 "代码编辑"
    description?: string                                // 分组描述
    icon?: React.ComponentType<{ className?: string }>  // 分组图标
    prefix: KeyPress                                    // 前缀快捷键，如 ⌘K
}

/**
 * 快捷键绑定定义
 */
export interface Keybinding {
    id: string                                          // 唯一标识
    name: string                                        // 快捷键名称，如 "添加注释"
    description?: string                                // 详细描述
    icon?: React.ComponentType<{ className?: string }>  // 图标

    // === 快捷键定义（二选一）===

    // 方式1: 单键快捷键
    key?: string
    modifiers?: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }

    // 方式2: 组合快捷键
    chordGroupId?: string                               // 关联的组合分组 ID
    chordSuffix?: KeyPress                              // 后缀快捷键，如 C（完整为 ⌘K C）

    // === 命令和条件 ===
    command: string                                     // 要执行的命令 ID
    when?: string                                       // When 条件表达式
    priority?: number                                   // 优先级（数值越大优先级越高）
}

/**
 * 命令定义
 */
export interface Command {
    id: string
    title: string
    handler: (context: KeyboardContext) => void
    icon?: React.ComponentType<{ className?: string }>
}

/**
 * 组合快捷键模式
 */
export type ChordMode = 'visual' | 'vscode'

/**
 * 快捷键系统配置
 */
export interface KeyboardConfig {
    chordMode: ChordMode                // 组合快捷键模式
    chordTimeout: number                // 组合键超时时间（毫秒）
    holdThreshold: number               // 长按阈值（毫秒），超过则进入松开释放模式
}

/**
 * 用户自定义快捷键绑定
 */
export interface CustomKeybinding {
    originalId: string                  // 要覆盖的原始快捷键 ID
    key?: string | null                 // 自定义的新快捷键（null 表示禁用）
    modifiers?: {
        meta?: boolean
        ctrl?: boolean
        alt?: boolean
        shift?: boolean
    }
    enabled: boolean                    // 是否启用
}

/**
 * 快捷键配置存储结构
 */
export interface KeyboardShortcutsConfig {
    chordMode: ChordMode
    chordTimeout: number
    holdThreshold: number
    customBindings: CustomKeybinding[]
}

/**
 * 键盘上下文
 */
export interface KeyboardContext {
    // 焦点相关
    focusedElement: string | null
    isInputFocused: boolean
    isTextAreaFocused: boolean

    // Tab 相关
    activeTab: string
    openTabCount: number

    // 对话框/模态框
    dialogOpen: boolean
    paletteOpen: boolean
    chordPaletteOpen: boolean           // 组合键面板是否打开
    hintModeActive: boolean             // Hint Mode 是否激活

    // 选择状态
    selectedEmailCount: number
    selectedAccountId: string | null

    // 编辑状态
    isEditing: boolean
    hasUnsavedChanges: boolean

    // 自定义扩展
    [key: string]: unknown
}

/**
 * 组合快捷键面板状态
 */
export interface ChordPaletteState {
    isOpen: boolean
    activeGroup: ChordGroup | null          // 当前激活的组合分组
    availableGroups: ChordGroup[]           // 所有可用的组合分组
    availableBindings: Keybinding[]         // 当前分组下的可用快捷键
    isHoldMode: boolean                     // 是否进入长按模式
    keyDownTime: number | null              // 按键按下时间戳
}

/**
 * 默认配置
 */
export const DEFAULT_KEYBOARD_CONFIG: KeyboardShortcutsConfig = {
    chordMode: 'visual',
    chordTimeout: 2000,
    holdThreshold: 1000,
    customBindings: []
}

/**
 * 默认键盘上下文
 */
export const DEFAULT_KEYBOARD_CONTEXT: KeyboardContext = {
    focusedElement: null,
    isInputFocused: false,
    isTextAreaFocused: false,
    activeTab: 'dashboard',
    openTabCount: 1,
    dialogOpen: false,
    paletteOpen: false,
    chordPaletteOpen: false,
    hintModeActive: false,
    selectedEmailCount: 0,
    selectedAccountId: null,
    isEditing: false,
    hasUnsavedChanges: false
}
