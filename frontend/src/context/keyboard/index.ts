/**
 * 键盘快捷键系统
 * 导出所有公共 API
 */

// Provider 和 Hooks
export {
    KeyboardProvider,
    useKeyboard,
    useKeybinding,
    useCommand,
    useKeyboardContext
} from './keyboard-provider'

// 默认快捷键
export { DefaultKeybindings } from './default-keybindings'

// 类型
export type {
    Keybinding,
    Command,
    ChordGroup,
    KeyPress,
    KeyboardContext,
    KeyboardConfig,
    KeyboardShortcutsConfig,
    CustomKeybinding,
    ChordMode,
    ChordPaletteState
} from './types'

// 常量
export { DEFAULT_KEYBOARD_CONFIG, DEFAULT_KEYBOARD_CONTEXT } from './types'

// 组件
export { ChordPalette, KeyBadge, formatKeybinding } from './chord-palette'

// 工具
export { evaluateWhen } from './when-evaluator'
export { KeyboardContextCollector } from './context-collector'
export { ChordResolver } from './chord-resolver'
