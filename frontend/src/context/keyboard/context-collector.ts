/**
 * 键盘上下文收集器
 * 收集当前应用状态作为 when 条件的上下文
 */

import { KeyboardContext, DEFAULT_KEYBOARD_CONTEXT } from './types'

export class KeyboardContextCollector {
    private additionalContext: Record<string, unknown> = {}

    /**
     * 收集当前键盘上下文
     */
    collect(): KeyboardContext {
        const activeElement = document.activeElement
        const tagName = activeElement?.tagName?.toLowerCase() || ''

        // 检查焦点元素
        const isInputFocused = tagName === 'input' || tagName === 'select'
        const isTextAreaFocused = tagName === 'textarea'
        const isContentEditable = activeElement?.hasAttribute('contenteditable') || false

        // 检查对话框状态
        const dialogOpen = this.checkDialogOpen()

        // 获取焦点元素标识
        const focusedElement = this.getFocusedElementId(activeElement)

        return {
            ...DEFAULT_KEYBOARD_CONTEXT,
            ...this.additionalContext,
            focusedElement,
            isInputFocused: isInputFocused || isContentEditable,
            isTextAreaFocused: isTextAreaFocused || isContentEditable,
            dialogOpen,
        }
    }

    /**
     * 设置额外的上下文值
     */
    setContext(key: string, value: unknown): void {
        this.additionalContext[key] = value
    }

    /**
     * 移除上下文值
     */
    removeContext(key: string): void {
        delete this.additionalContext[key]
    }

    /**
     * 获取焦点元素的标识
     */
    private getFocusedElementId(element: Element | null): string | null {
        if (!element) return null

        // 优先使用 data-keyboard-id
        const keyboardId = element.getAttribute('data-keyboard-id')
        if (keyboardId) return keyboardId

        // 其次使用 id
        if (element.id) return element.id

        // 最后使用标签名
        return element.tagName.toLowerCase()
    }

    /**
     * 检查是否有对话框打开
     */
    private checkDialogOpen(): boolean {
        // 检查 Radix Dialog
        const radixDialog = document.querySelector('[data-radix-dialog-content]')
        if (radixDialog) return true

        // 检查通用的模态框类
        const modal = document.querySelector('.modal, [role="dialog"], [data-state="open"]')
        if (modal) return true

        // 检查 body 上的模态框指示器
        const body = document.body
        if (body.classList.contains('modal-open') || body.style.overflow === 'hidden') {
            return true
        }

        return false
    }
}
