'use client'
import { logger } from '@/lib/logger';

/**
 * 默认快捷键注册
 * 注册应用的内置快捷键和命令
 */

import { useEffect } from 'react'
import { Command, Search, Layers, Settings, Home, Mail, Zap, Key, PlusCircle } from 'lucide-react'
import { useKeyboard } from './keyboard-provider'
import type { Keybinding, Command as CommandType, ChordGroup } from './types'

/**
 * 默认快捷键注册组件
 * 在应用加载时注册所有内置快捷键
 */
export function DefaultKeybindings() {
    const {
        registerKeybinding,
        registerCommand,
        registerChordGroup,
        executeCommand
    } = useKeyboard()

    useEffect(() => {
        // ============ 注册命令 ============

        // 命令面板
        registerCommand({
            id: 'commandPalette.toggle',
            title: '打开命令面板',
            icon: Command,
            handler: () => {
                // 触发命令面板打开事件
                window.dispatchEvent(new CustomEvent('toggleCommandPalette'))
            }
        })

        // 全局搜索
        registerCommand({
            id: 'focusGlobalSearch',
            title: '快速查找邮件',
            icon: Search,
            handler: () => {
                window.dispatchEvent(new CustomEvent('focusGlobalSearch'))
            }
        })

        // 切换到仪表板
        registerCommand({
            id: 'tab.dashboard',
            title: '打开仪表板',
            icon: Home,
            handler: () => {
                window.dispatchEvent(new CustomEvent('switchTab', {
                    detail: { tab: 'dashboard' }
                }))
            }
        })

        // 切换到邮箱管理
        registerCommand({
            id: 'tab.classicMailbox',
            title: '打开邮箱管理器',
            icon: Mail,
            handler: () => {
                window.dispatchEvent(new CustomEvent('switchTab', {
                    detail: { tab: 'classic-mailbox' }
                }))
            }
        })

        // 切换到触发器
        registerCommand({
            id: 'tab.triggers',
            title: '打开触发器管理',
            icon: Zap,
            handler: () => {
                window.dispatchEvent(new CustomEvent('switchTab', {
                    detail: { tab: 'triggers' }
                }))
            }
        })

        // 创建触发器
        registerCommand({
            id: 'trigger.create',
            title: '创建新触发器',
            icon: PlusCircle,
            handler: () => {
                window.dispatchEvent(new CustomEvent('switchTab', {
                    detail: { tab: 'trigger-create' }
                }))
            }
        })

        // 打开系统设置
        registerCommand({
            id: 'tab.systemConfig',
            title: '打开系统设置',
            icon: Settings,
            handler: () => {
                window.dispatchEvent(new CustomEvent('switchTab', {
                    detail: { tab: 'system-config' }
                }))
            }
        })

        // 打开 OAuth2 配置
        registerCommand({
            id: 'tab.oauth2Config',
            title: '打开 OAuth2 配置',
            icon: Key,
            handler: () => {
                window.dispatchEvent(new CustomEvent('switchTab', {
                    detail: { tab: 'oauth2-config' }
                }))
            }
        })

        // ============ 注册单键快捷键 ============

        // CMD+E: 命令面板
        registerKeybinding({
            id: 'kb.commandPalette',
            name: '命令面板',
            description: '打开命令面板，快速执行操作',
            icon: Command,
            key: 'e',
            modifiers: { meta: true },
            command: 'commandPalette.toggle',
            priority: 1000
        })

        // CMD+G: 全局搜索
        registerKeybinding({
            id: 'kb.focusSearch',
            name: '快速查找邮件',
            description: '聚焦到全局搜索框',
            icon: Search,
            key: 'g',
            modifiers: { meta: true },
            command: 'focusGlobalSearch',
            when: '!isInputFocused && !dialogOpen',
            priority: 100
        })

        // CMD+J: Hint Mode (元素标签模式)
        registerCommand({
            id: 'hintMode.activate',
            title: '激活元素标签模式',
            icon: Layers,
            handler: () => {
                window.dispatchEvent(new CustomEvent('activateHintMode'))
            }
        })

        registerKeybinding({
            id: 'kb.hintMode',
            name: '元素标签模式',
            description: '在可交互元素上显示字母标签，输入字母快速点击',
            icon: Layers,
            key: 'j',
            modifiers: { meta: true },
            command: 'hintMode.activate',
            // 不限制使用场景，方便在任何情况下使用
            priority: 1000  // 提高优先级
        })

        // ============ 注册组合快捷键分组 ============

        // 导航分组 (CMD+K)
        registerChordGroup({
            id: 'navigation',
            name: '快速导航',
            description: '快速切换到不同页面',
            icon: Layers,
            prefix: { key: 'k', modifiers: { meta: true } }
        })

        // 设置分组 (CMD+;)
        registerChordGroup({
            id: 'settings',
            name: '设置',
            description: '打开各种设置页面',
            icon: Settings,
            prefix: { key: ';', modifiers: { meta: true } }
        })

        // ============ 注册组合快捷键 ============

        // 导航组 - CMD+T D: 仪表板
        registerKeybinding({
            id: 'kb.nav.dashboard',
            name: '仪表板',
            description: '打开仪表板页面',
            icon: Home,
            chordGroupId: 'navigation',
            chordSuffix: { key: 'd' },
            command: 'tab.dashboard',
            priority: 10
        })

        // 导航组 - CMD+T M: 邮箱管理器
        registerKeybinding({
            id: 'kb.nav.mailbox',
            name: '邮箱管理器',
            description: '打开经典邮箱管理器',
            icon: Mail,
            chordGroupId: 'navigation',
            chordSuffix: { key: 'm' },
            command: 'tab.classicMailbox',
            priority: 10
        })

        // 导航组 - CMD+T T: 触发器
        registerKeybinding({
            id: 'kb.nav.triggers',
            name: '触发器管理',
            description: '打开触发器管理页面',
            icon: Zap,
            chordGroupId: 'navigation',
            chordSuffix: { key: 't' },
            command: 'tab.triggers',
            priority: 10
        })

        // 导航组 - CMD+T N: 创建触发器
        registerKeybinding({
            id: 'kb.nav.triggerCreate',
            name: '创建触发器',
            description: '创建新的触发器规则',
            icon: PlusCircle,
            chordGroupId: 'navigation',
            chordSuffix: { key: 'n' },
            command: 'trigger.create',
            priority: 10
        })

        // 设置组 - CMD+, S: 系统设置
        registerKeybinding({
            id: 'kb.settings.system',
            name: '系统设置',
            description: '打开系统配置页面',
            icon: Settings,
            chordGroupId: 'settings',
            chordSuffix: { key: 's' },
            command: 'tab.systemConfig',
            priority: 10
        })

        // 设置组 - CMD+, O: OAuth2 配置
        registerKeybinding({
            id: 'kb.settings.oauth2',
            name: 'OAuth2 配置',
            description: '打开 OAuth2 配置页面',
            icon: Key,
            chordGroupId: 'settings',
            chordSuffix: { key: 'o' },
            command: 'tab.oauth2Config',
            priority: 10
        })

        logger.debug('[DefaultKeybindings] Registered all default keybindings')

    }, [registerKeybinding, registerCommand, registerChordGroup])

    return null
}
