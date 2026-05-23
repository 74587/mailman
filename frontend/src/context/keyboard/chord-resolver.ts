import { logger } from '@/lib/logger';
/**
 * 组合快捷键解析器
 * 处理单键和组合键快捷键的匹配与执行
 */

import {
    Keybinding,
    KeyPress,
    ChordGroup,
    Command,
    KeyboardContext,
    KeyboardConfig,
    ChordPaletteState,
    ChordMode,
    CustomKeybinding,
    DEFAULT_KEYBOARD_CONFIG
} from './types'
import { evaluateWhen } from './when-evaluator'

export class ChordResolver {
    private keybindings: Keybinding[] = []
    private chordGroups: Map<string, ChordGroup> = new Map()
    private commands: Map<string, Command> = new Map()
    private customBindings: CustomKeybinding[] = []

    private config: KeyboardConfig = { ...DEFAULT_KEYBOARD_CONFIG }

    // 组合键面板状态
    private paletteState: ChordPaletteState = {
        isOpen: false,
        activeGroup: null,
        availableGroups: [],
        availableBindings: [],
        isHoldMode: false,
        keyDownTime: null
    }

    // VS Code 模式的等待状态
    private vscodeChordState: {
        active: boolean
        group: ChordGroup | null
        timeout: ReturnType<typeof setTimeout> | null
    } = { active: false, group: null, timeout: null }

    // 超时定时器
    private holdCheckTimeout: ReturnType<typeof setTimeout> | null = null
    private autoCloseTimeout: ReturnType<typeof setTimeout> | null = null

    // 状态变化回调
    private onPaletteStateChange: ((state: ChordPaletteState) => void) | null = null

    /**
     * 设置配置
     */
    setConfig(config: Partial<KeyboardConfig>): void {
        this.config = { ...this.config, ...config }
    }

    /**
     * 获取配置
     */
    getConfig(): KeyboardConfig {
        return { ...this.config }
    }

    /**
     * 设置自定义快捷键
     */
    setCustomBindings(bindings: CustomKeybinding[]): void {
        this.customBindings = bindings
    }

    /**
     * 设置面板状态变化回调
     */
    onStateChange(callback: (state: ChordPaletteState) => void): void {
        this.onPaletteStateChange = callback
    }

    /**
     * 注册组合快捷键分组
     */
    registerChordGroup(group: ChordGroup): void {
        this.chordGroups.set(group.id, group)
    }

    /**
     * 注销组合快捷键分组
     */
    unregisterChordGroup(id: string): void {
        this.chordGroups.delete(id)
    }

    /**
     * 注册快捷键绑定
     */
    registerKeybinding(binding: Keybinding): void {
        // 检查是否已存在
        const existingIndex = this.keybindings.findIndex(kb => kb.id === binding.id)
        if (existingIndex >= 0) {
            this.keybindings[existingIndex] = binding
            return
        }

        // 按优先级插入
        const index = this.keybindings.findIndex(
            kb => (kb.priority ?? 0) < (binding.priority ?? 0)
        )
        if (index === -1) {
            this.keybindings.push(binding)
        } else {
            this.keybindings.splice(index, 0, binding)
        }
    }

    /**
     * 注销快捷键绑定
     */
    unregisterKeybinding(id: string): void {
        const index = this.keybindings.findIndex(kb => kb.id === id)
        if (index >= 0) {
            this.keybindings.splice(index, 1)
        }
    }

    /**
     * 注册命令
     */
    registerCommand(command: Command): void {
        this.commands.set(command.id, command)
    }

    /**
     * 注销命令
     */
    unregisterCommand(id: string): void {
        this.commands.delete(id)
    }

    /**
     * 获取命令
     */
    getCommand(id: string): Command | undefined {
        return this.commands.get(id)
    }

    /**
     * 获取所有快捷键
     */
    getAllKeybindings(): Keybinding[] {
        return [...this.keybindings]
    }

    /**
     * 获取所有命令
     */
    getAllCommands(): Command[] {
        return Array.from(this.commands.values())
    }

    /**
     * 获取所有组合分组
     */
    getAllChordGroups(): ChordGroup[] {
        return Array.from(this.chordGroups.values())
    }

    /**
     * 处理键盘按下事件
     */
    handleKeyDown(event: KeyboardEvent, context: KeyboardContext): boolean {
        const keyPress = this.eventToKeyPress(event)

        // 忽略单独的修饰键事件（Meta, Control, Alt, Shift）
        // 这些键按下时会触发 keydown，但我们只关心实际的字符键
        const modifierKeys = ['meta', 'control', 'alt', 'shift']
        if (modifierKeys.includes(keyPress.key.toLowerCase())) {
            return false
        }

        // 1. 如果可视化面板已打开，处理面板内的快捷键选择
        if (this.paletteState.isOpen && this.config.chordMode === 'visual') {
            return this.handleChordPaletteKeyDown(keyPress, event, context)
        }

        // 2. 如果处于 VS Code 模式的等待状态
        if (this.vscodeChordState.active && this.config.chordMode === 'vscode') {
            return this.handleVSCodeChordContinuation(keyPress, event, context)
        }

        // 3. 检查是否匹配单键快捷键
        if (this.tryExecuteSingleKeybinding(keyPress, event, context)) {
            return true
        }

        // 4. 检查是否匹配组合快捷键前缀
        return this.tryStartChord(keyPress, event, context)
    }

    /**
     * 处理键盘松开事件（用于长按模式检测）
     */
    handleKeyUp(event: KeyboardEvent): void {
        if (!this.paletteState.isOpen || !this.paletteState.isHoldMode) return

        const keyPress = this.eventToKeyPress(event)
        const activeGroup = this.paletteState.activeGroup

        // 检查是否松开了前缀键的修饰键或主键
        if (activeGroup && this.keyPressMatchesPrefix(keyPress, activeGroup.prefix)) {
            this.closePalette()
        }
    }

    /**
     * 获取应用了自定义绑定后的快捷键
     */
    private getEffectiveBinding(binding: Keybinding): Keybinding | null {
        const custom = this.customBindings.find(cb => cb.originalId === binding.id)

        if (!custom) {
            return binding
        }

        // 如果禁用了这个快捷键
        if (!custom.enabled || custom.key === null) {
            return null
        }

        // 返回覆盖后的绑定
        return {
            ...binding,
            key: custom.key,
            modifiers: custom.modifiers
        }
    }

    /**
     * 尝试执行单键快捷键
     */
    private tryExecuteSingleKeybinding(
        keyPress: KeyPress,
        event: KeyboardEvent,
        context: KeyboardContext
    ): boolean {
        // 过滤出单键快捷键（非组合键）
        const singleBindings = this.keybindings.filter(kb => !kb.chordGroupId)

        for (const binding of singleBindings) {
            // 应用自定义绑定
            const effectiveBinding = this.getEffectiveBinding(binding)
            if (!effectiveBinding) continue

            // 检查按键是否匹配
            if (!this.matchesSingleKey(effectiveBinding, keyPress)) continue

            // 检查 when 条件
            if (!evaluateWhen(effectiveBinding.when, context)) continue

            // 匹配成功，执行命令
            event.preventDefault()
            event.stopPropagation()
            this.executeCommand(effectiveBinding.command, context)
            return true
        }

        return false
    }

    /**
     * 尝试开始组合快捷键
     */
    private tryStartChord(
        keyPress: KeyPress,
        event: KeyboardEvent,
        context: KeyboardContext
    ): boolean {
        // 查找匹配前缀的组合分组
        const allGroups = Array.from(this.chordGroups.values())

        const matchingGroups = allGroups.filter(group => {
            return this.keyPressEquals(group.prefix, keyPress)
        })

        if (matchingGroups.length === 0) return false

        event.preventDefault()
        event.stopPropagation()

        // 获取第一个匹配的分组
        const primaryGroup = matchingGroups[0]

        // 获取该分组下的所有可用快捷键
        const groupBindings = this.getBindingsForGroup(primaryGroup.id, context)

        if (this.config.chordMode === 'visual') {
            // 可视化模式：打开面板
            this.openPalette(primaryGroup, matchingGroups, groupBindings)
        } else {
            // VS Code 模式：进入等待状态
            this.startVSCodeChordWait(primaryGroup)
        }

        return true
    }

    /**
     * 打开组合快捷键面板（可视化模式）
     */
    private openPalette(
        activeGroup: ChordGroup,
        availableGroups: ChordGroup[],
        bindings: Keybinding[]
    ): void {
        // 清除之前的定时器
        this.clearTimeouts()

        const keyDownTime = Date.now()

        this.paletteState = {
            isOpen: true,
            activeGroup,
            availableGroups,
            availableBindings: bindings,
            isHoldMode: false,
            keyDownTime
        }

        this.notifyStateChange()

        // 设置长按检测
        this.holdCheckTimeout = setTimeout(() => {
            if (!this.paletteState.isOpen) return

            // 检测到长按，进入长按模式
            this.paletteState.isHoldMode = true
            this.notifyStateChange()
        }, this.config.holdThreshold)

        // 设置超时自动关闭（仅非长按模式）
        this.autoCloseTimeout = setTimeout(() => {
            if (this.paletteState.isOpen && !this.paletteState.isHoldMode) {
                this.closePalette()
            }
        }, this.config.chordTimeout)
    }

    /**
     * 关闭面板
     */
    closePalette(): void {
        this.clearTimeouts()

        this.paletteState = {
            isOpen: false,
            activeGroup: null,
            availableGroups: [],
            availableBindings: [],
            isHoldMode: false,
            keyDownTime: null
        }

        this.notifyStateChange()
    }

    /**
     * 清除所有定时器
     */
    private clearTimeouts(): void {
        if (this.holdCheckTimeout) {
            clearTimeout(this.holdCheckTimeout)
            this.holdCheckTimeout = null
        }
        if (this.autoCloseTimeout) {
            clearTimeout(this.autoCloseTimeout)
            this.autoCloseTimeout = null
        }
    }

    /**
     * 处理面板内的快捷键按下
     */
    private handleChordPaletteKeyDown(
        keyPress: KeyPress,
        event: KeyboardEvent,
        context: KeyboardContext
    ): boolean {
        // ESC 关闭面板
        if (keyPress.key.toLowerCase() === 'escape') {
            event.preventDefault()
            this.closePalette()
            return true
        }

        // 检查是否匹配当前分组的后缀快捷键
        const matchingBinding = this.paletteState.availableBindings.find(binding => {
            if (!binding.chordSuffix) return false
            return this.keyPressEquals(binding.chordSuffix, keyPress)
        })

        if (matchingBinding) {
            event.preventDefault()
            this.closePalette()
            this.executeCommand(matchingBinding.command, context)
            return true
        }

        // 检查是否切换到其他组合分组（按下相同前缀）
        const newGroup = this.paletteState.availableGroups.find(group =>
            group.id !== this.paletteState.activeGroup?.id &&
            this.keyPressEquals(group.prefix, keyPress)
        )

        if (newGroup) {
            event.preventDefault()
            this.selectGroup(newGroup.id, context)
            return true
        }

        // 支持 Tab/Shift+Tab 切换分组
        if (keyPress.key.toLowerCase() === 'tab') {
            event.preventDefault()
            this.switchGroup(keyPress.modifiers?.shift ? -1 : 1, context)
            return true
        }

        return false
    }

    /**
     * 选择分组
     */
    selectGroup(groupId: string, context: KeyboardContext): void {
        const group = this.chordGroups.get(groupId)
        if (!group) return

        const newBindings = this.getBindingsForGroup(groupId, context)
        this.paletteState.activeGroup = group
        this.paletteState.availableBindings = newBindings
        this.notifyStateChange()
    }

    /**
     * VS Code 模式：开始等待后续按键
     */
    private startVSCodeChordWait(group: ChordGroup): void {
        this.cancelVSCodeChord()

        this.vscodeChordState = {
            active: true,
            group,
            timeout: setTimeout(() => {
                logger.debug('[Chord] VS Code mode timeout')
                this.cancelVSCodeChord()
            }, this.config.chordTimeout)
        }
    }

    /**
     * VS Code 模式：处理后续按键
     */
    private handleVSCodeChordContinuation(
        keyPress: KeyPress,
        event: KeyboardEvent,
        context: KeyboardContext
    ): boolean {
        const group = this.vscodeChordState.group
        if (!group) {
            this.cancelVSCodeChord()
            return false
        }

        // 查找匹配的快捷键
        const matchingBinding = this.keybindings.find(binding =>
            binding.chordGroupId === group.id &&
            binding.chordSuffix &&
            this.keyPressEquals(binding.chordSuffix, keyPress) &&
            evaluateWhen(binding.when, context)
        )

        this.cancelVSCodeChord()

        if (matchingBinding) {
            event.preventDefault()
            this.executeCommand(matchingBinding.command, context)
            return true
        }

        return false
    }

    /**
     * 取消 VS Code 模式的等待
     */
    private cancelVSCodeChord(): void {
        if (this.vscodeChordState.timeout) {
            clearTimeout(this.vscodeChordState.timeout)
        }
        this.vscodeChordState = { active: false, group: null, timeout: null }
    }

    /**
     * 切换组合分组
     */
    private switchGroup(direction: number, context: KeyboardContext): void {
        const groups = this.paletteState.availableGroups
        if (groups.length <= 1) return

        const currentIndex = groups.findIndex(g => g.id === this.paletteState.activeGroup?.id)
        const newIndex = (currentIndex + direction + groups.length) % groups.length
        const newGroup = groups[newIndex]

        this.paletteState.activeGroup = newGroup
        this.paletteState.availableBindings = this.getBindingsForGroup(newGroup.id, context)
        this.notifyStateChange()
    }

    /**
     * 获取指定分组的所有快捷键
     */
    private getBindingsForGroup(groupId: string, context: KeyboardContext): Keybinding[] {
        return this.keybindings.filter(binding => {
            if (binding.chordGroupId !== groupId) return false

            // 检查自定义绑定是否禁用
            const custom = this.customBindings.find(cb => cb.originalId === binding.id)
            if (custom && !custom.enabled) return false

            return evaluateWhen(binding.when, context)
        })
    }

    /**
     * 获取当前面板状态
     */
    getPaletteState(): ChordPaletteState {
        return { ...this.paletteState }
    }

    // ============ 辅助方法 ============

    private notifyStateChange(): void {
        this.onPaletteStateChange?.(this.getPaletteState())
    }

    private eventToKeyPress(event: KeyboardEvent): KeyPress {
        return {
            key: (event.key || '').toLowerCase(),
            modifiers: {
                meta: event.metaKey,
                ctrl: event.ctrlKey,
                alt: event.altKey,
                shift: event.shiftKey
            }
        }
    }

    private matchesSingleKey(binding: Keybinding, keyPress: KeyPress): boolean {
        if (!binding.key || binding.key.toLowerCase() !== keyPress.key) return false
        return this.modifiersMatch(binding.modifiers, keyPress.modifiers)
    }

    private keyPressEquals(a: KeyPress, b: KeyPress): boolean {
        if (a.key.toLowerCase() !== b.key.toLowerCase()) return false
        return this.modifiersMatch(a.modifiers, b.modifiers)
    }

    private keyPressMatchesPrefix(keyPress: KeyPress, prefix: KeyPress): boolean {
        // 检查释放的键是否是前缀的修饰键或主键
        const pm = prefix.modifiers ?? {}
        const key = keyPress.key.toLowerCase()

        if (pm.meta && key === 'meta') return true
        if (pm.ctrl && key === 'control') return true
        if (pm.alt && key === 'alt') return true
        if (pm.shift && key === 'shift') return true

        return key === prefix.key.toLowerCase()
    }

    private modifiersMatch(
        a: KeyPress['modifiers'],
        b: KeyPress['modifiers']
    ): boolean {
        const am = a ?? {}
        const bm = b ?? {}

        // Mac 上 meta 键是 ⌘，Windows 上使用 Ctrl
        const isMac = typeof navigator !== 'undefined' &&
            navigator.platform.toUpperCase().indexOf('MAC') >= 0

        const metaMatch = isMac
            ? (bm.meta ?? false) === (am.meta ?? false)
            : (bm.ctrl ?? false) === (am.meta ?? false)

        return metaMatch &&
            (bm.alt ?? false) === (am.alt ?? false) &&
            (bm.shift ?? false) === (am.shift ?? false)
    }

    private executeCommand(commandId: string, context: KeyboardContext): void {
        const command = this.commands.get(commandId)
        if (command) {
            logger.debug(`[Keybinding] Execute: ${commandId}`)
            try {
                command.handler(context)
            } catch (error) {
                console.error(`[Keybinding] Command execution failed: ${commandId}`, error)
            }
        } else {
            console.warn(`[Keybinding] Command not found: ${commandId}`)
        }
    }
}
