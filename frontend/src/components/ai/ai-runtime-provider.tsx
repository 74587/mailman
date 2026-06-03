'use client'

import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { openAIService } from '@/services/openai.service'
import { groupNames, menuRegistry } from '@/lib/menu-config'
import type { OpenAIConfig } from '@/types/openai'
import {
    AIActionResult,
    AIChatMessage,
    AICompressedContext,
    AIGlobalContext,
    AIPlannedAction,
    AISkill,
    AISkillAction,
    AISubagentStep,
    AISubagentTask,
    AITaskStatus,
} from './types'

interface NavigationContext {
    activeTab: string
    openTabs: string[]
}

interface AIRuntimeContextValue {
    isOpen: boolean
    messages: AIChatMessage[]
    tasks: AISubagentTask[]
    currentTask: AISubagentTask | null
    skills: AISkill[]
    navigation: NavigationContext
    selectedText: string
    openAssistant: () => void
    closeAssistant: () => void
    toggleAssistant: () => void
    newSession: () => void
    sendMessage: (content: string) => Promise<void>
    cancelTask: (taskId?: string) => void
    registerSkill: (skill: AISkill) => () => void
    setNavigationContext: (context: NavigationContext) => void
    toggleTaskThinking: (taskId: string) => void
}

const AIRuntimeContext = createContext<AIRuntimeContextValue | null>(null)

const TASK_POLL_INTERVAL_MS = 80
const WAIT_FOR_SKILL_TIMEOUT_MS = 4000
const SELECTED_TEXT_LIMIT = 1200
const DIRECT_CHAT_MAX_TOKENS = 1800
const CONVERSATION_HISTORY_LIMIT = 8
const LOCAL_UNSUPPORTED_RESPONSE = '我已经感知到当前页面，但这个请求还没有对应的页面 skill。可以先试试“搜索 xxx 邮箱账户”“添加账户”或“打开 OAuth2 配置”。'
const MAX_ACTION_ATTEMPTS = 4
const MAX_DYNAMIC_ACTION_ATTEMPTS = 6
const OPEN_PAGE_ACTION_NAME = 'openPage'
const DIRECT_CHAT_RESPONSE = 'direct_chat'

type AIConversationTurn = Pick<AIChatMessage, 'role' | 'content'>

const unavailableActionRun = () => ({
    success: false,
    summary: '这个页面能力需要先打开对应页面后才能执行。',
})

const createOpenPageAction = (title: string): AISkillAction => ({
    name: OPEN_PAGE_ACTION_NAME,
    title: `打开${title}`,
    description: `切换到${title}页面。`,
    risk: 'navigation',
    run: unavailableActionRun,
})

function mergeSkillDefinitions(base: AISkill | undefined, override: AISkill): AISkill {
    const actionMap = new Map<string, AISkillAction>()
    base?.actions.forEach(action => actionMap.set(action.name, action))
    override.actions.forEach(action => actionMap.set(action.name, action))

    return {
        ...base,
        ...override,
        aliases: Array.from(new Set([...(base?.aliases || []), ...(override.aliases || [])])),
        pageTabs: override.pageTabs || base?.pageTabs,
        actions: Array.from(actionMap.values()),
    }
}

const GLOBAL_CORE_SKILL_CATALOG: AISkill[] = [
    {
        id: 'accounts',
        title: '邮箱账户管理',
        description: '搜索、筛选、添加邮箱账户，并可打开指定账户的邮件。',
        aliases: ['邮箱账户', '邮箱账号', '账户管理', 'mail accounts'],
        pageTabs: ['accounts'],
        actions: [
            {
                name: 'searchAccounts',
                title: '搜索邮箱账户',
                description: '按邮箱、域名、转发地址或备注搜索账户。',
                risk: 'read',
                parameters: { query: '搜索关键词' },
                run: unavailableActionRun,
            },
            {
                name: 'viewAccountEmails',
                title: '查看账户邮件',
                description: '按邮箱地址定位账户，并打开该账户的邮件列表或收件箱。',
                risk: 'navigation',
                parameters: { email: '邮箱地址' },
                run: unavailableActionRun,
            },
            {
                name: 'openAddAccountModal',
                title: '打开添加账户窗口',
                description: '打开账户添加表单。',
                risk: 'write',
                run: unavailableActionRun,
            },
            {
                name: 'openOAuth2Config',
                title: '打开 OAuth2 配置',
                description: '切换到 OAuth2 配置页面。',
                risk: 'navigation',
                run: unavailableActionRun,
            },
        ],
    },
    {
        id: 'classic-mailbox',
        title: '经典邮件管理器',
        description: '查看指定邮箱账户的邮件列表、收件箱和邮件详情。',
        aliases: ['收件箱', '邮件列表', '邮箱邮件', 'mailbox', 'inbox'],
        pageTabs: ['classic-mailbox'],
        actions: [
            {
                name: 'openAccountInbox',
                title: '打开账户收件箱',
                description: '按邮箱地址定位账户并加载该账户最新邮件。',
                risk: 'navigation',
                parameters: { email: '邮箱地址' },
                run: unavailableActionRun,
            },
            {
                name: 'getSelectedEmailDetails',
                title: '读取当前选中邮件',
                description: '读取当前已选中邮件的主题、发件人、收件人、正文摘要和附件信息。',
                risk: 'read',
                run: unavailableActionRun,
            },
        ],
    },
]

const GLOBAL_SKILL_CATALOG: AISkill[] = (() => {
    const catalog = new Map<string, AISkill>()

    menuRegistry.forEach(item => {
        catalog.set(item.id, {
            id: item.id,
            title: item.name,
            description: `打开${groupNames[item.group] || '系统'}中的${item.name}页面，并在页面加载后使用该页面已注册的更多能力。`,
            aliases: [item.name, item.id],
            pageTabs: [item.id],
            actions: [createOpenPageAction(item.name)],
        })
    })

    GLOBAL_CORE_SKILL_CATALOG.forEach(skill => {
        catalog.set(skill.id, mergeSkillDefinitions(catalog.get(skill.id), skill))
    })

    return Array.from(catalog.values())
})()

function createId(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function now() {
    return Date.now()
}

function formatDuration(ms?: number) {
    if (ms === undefined) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
}

function maskSensitiveText(value: string) {
    return value
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [hidden]')
        .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-[hidden]')
        .replace(/(api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s,;]+/gi, '$1=[hidden]')
}

function trimText(value: string, limit: number) {
    const text = maskSensitiveText(value.trim())
    if (text.length <= limit) return text
    return `${text.slice(0, limit)}...`
}

function readSelectedText() {
    if (typeof window === 'undefined') return ''

    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        const start = active.selectionStart ?? 0
        const end = active.selectionEnd ?? 0
        if (end > start) {
            return trimText(active.value.slice(start, end), SELECTED_TEXT_LIMIT)
        }
    }

    const selection = window.getSelection()?.toString() || ''
    return trimText(selection, SELECTED_TEXT_LIMIT)
}

function summarizeFocusedElement(): AIGlobalContext['focusedElement'] {
    if (typeof document === 'undefined') return undefined
    const active = document.activeElement
    if (!active || active === document.body) return undefined

    const element = active as HTMLElement
    const text = element.innerText || element.textContent || ''
    return {
        tagName: element.tagName.toLowerCase(),
        type: active instanceof HTMLInputElement ? active.type : undefined,
        placeholder: active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active.placeholder : undefined,
        ariaLabel: element.getAttribute('aria-label') || undefined,
        text: text ? trimText(text, 120) : undefined,
    }
}

function buildSkillSummary(skill: AISkill) {
    return {
        id: skill.id,
        title: skill.title,
        description: skill.description,
        actions: skill.actions.map(action => ({
            name: action.name,
            title: action.title,
            description: action.description,
            risk: action.risk,
        })),
    }
}

function normalizeQuery(raw: string) {
    return raw
        .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, '')
        .replace(/^(搜索|查找|查询|找一下|帮我查|帮我搜索|search)\s*[:：]?\s*/i, '')
        .replace(/^(以|用|按)\s*/i, '')
        .replace(/\s*(开头|开始|前缀|prefix).*/i, '')
        .replace(/\s*(的)?(邮件|邮箱账户|邮箱|账户|账号)$/i, '')
        .trim()
}

function extractSearchToken(raw: string) {
    const normalized = normalizeQuery(raw)
    if (!normalized) return ''

    const emailMatch = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    if (emailMatch?.[0]) return emailMatch[0]

    const prefixMatch = normalized.match(/(?:^|[\s：:，,])([A-Z0-9._%+-]{3,}(?:@[A-Z0-9.-]*)?)\s*(?:开头|开始|前缀|prefix)?/i)
    if (prefixMatch?.[1]) return prefixMatch[1]

    return normalized
}

function inferSearchQuery(input: string, selectedText: string) {
    const quoted = input.match(/[“"']([^“"']{1,160})[”"']/)
    if (quoted?.[1]) return extractSearchToken(quoted[1])

    const emailMatch = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    if (emailMatch?.[0]) return emailMatch[0]

    const explicitPrefixMatch = input.match(/(?:以|用|按)?\s*([A-Z0-9._%+-]{3,}(?:@[A-Z0-9.-]*)?)\s*(?:开头|开始|前缀|prefix)/i)
    if (explicitPrefixMatch?.[1]) return explicitPrefixMatch[1]

    const searchMatch = input.match(/(?:搜索|查找|查询|找一下|帮我查|帮我搜索|search)\s*[:：]?\s*(.{1,180})/i)
    if (searchMatch?.[1]) return extractSearchToken(searchMatch[1])

    if (selectedText) return extractSearchToken(selectedText)
    return ''
}

function inferEmailAddress(input: string, selectedText = '') {
    const emailMatch = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    if (emailMatch?.[0]) return emailMatch[0]

    const selectedEmailMatch = selectedText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    return selectedEmailMatch?.[0] || ''
}

function isViewEmailIntent(input: string) {
    return /(查看|看一下|打开|进入|浏览|显示|找|读取|查阅|搜索|read|view|open|check|show).*(邮件|邮箱|收件箱|inbox|mail)|(邮件|邮箱|收件箱|inbox|mail).*(查看|看一下|打开|进入|浏览|显示|找|读取|查阅|搜索|read|view|open|check|show)/i.test(input)
}

function isSelectedEmailQuestion(input: string) {
    return /((当前|现在|选中|已选|打开|正在看|这封|这条|current|selected|active|opened).*(邮件|email|mail).*(说|内容|讲|总结|摘要|详情|什么意思|是什么|what|say|says|about|content|detail|details|explain|summari[sz]e|summary))|((说|内容|讲|总结|摘要|详情|什么意思|是什么|what|say|says|about|content|detail|details|explain|summari[sz]e|summary).*(当前|现在|选中|已选|打开|正在看|这封|这条|current|selected|active|opened).*(邮件|email|mail))/i.test(input)
}

function planLocally(input: string, context: AICompressedContext, skills: AISkill[]): AIPlannedAction {
    const lower = input.toLowerCase()
    const activeTab = context.global.activeTab
    const selectedText = context.global.selectedText
    const hasAccountsSkill = skills.some(skill => skill.id === 'accounts')
    const accountsIntent = hasAccountsSkill || /(邮箱账户|邮箱账号|账户管理|账号管理|mail accounts?|accounts?)/i.test(input) || activeTab === 'accounts'
    const emailAddress = inferEmailAddress(input, selectedText)

    if (activeTab === 'classic-mailbox' && isSelectedEmailQuestion(input)) {
        return {
            skillId: 'classic-mailbox',
            actionName: 'getSelectedEmailDetails',
            params: {},
        }
    }

    if (emailAddress && isViewEmailIntent(input)) {
        return {
            skillId: 'classic-mailbox',
            actionName: 'openAccountInbox',
            params: { email: emailAddress },
            candidateActions: [
                { skillId: 'accounts', actionName: 'viewAccountEmails', params: { email: emailAddress } },
            ],
        }
    }

    if (!emailAddress && isViewEmailIntent(input)) {
        const query = inferSearchQuery(input, selectedText)
        if (query) {
            return {
                skillId: 'classic-mailbox',
                actionName: 'openAccountInbox',
                params: { query },
                candidateActions: [
                    { skillId: 'accounts', actionName: 'viewAccountEmails', params: { query } },
                ],
            }
        }
    }

    if (/^(清空|重置|新建)(当前)?(会话|对话)/.test(input.trim())) {
        return { response: '可以点击面板顶部的新建会话按钮清空当前临时上下文。' }
    }

    if (/(oauth2?|授权配置|客户端配置)/i.test(input)) {
        return {
            tabId: 'oauth2-config',
            response: '已准备切换到 OAuth2 配置。'
        }
    }

    if ((/(添加|新增|创建).*(账户|账号|邮箱)|add.*account/i.test(input)) && accountsIntent) {
        return {
            skillId: 'accounts',
            actionName: 'openAddAccountModal',
            params: {},
        }
    }

    if ((/(搜索|查找|查询|找一下)|search/i.test(input) || /@/.test(input)) && accountsIntent) {
        const query = inferSearchQuery(input, selectedText)
        if (query) {
            return {
                skillId: 'accounts',
                actionName: 'searchAccounts',
                params: { query },
            }
        }
    }

    if (/(当前|现在).*(页面|tab|标签|域名|地址)|where am i|current tab/i.test(input)) {
        return {
            response: `当前页面是 ${activeTab || '未知 tab'}，访问域是 ${context.global.host || context.global.origin || '未知域名'}。`
        }
    }

    return {
        response: LOCAL_UNSUPPORTED_RESPONSE
    }
}

interface AIRuntimeProviderProps {
    children: ReactNode
    userContext?: AIGlobalContext['user']
    enableModelPlanning?: boolean
}

interface AIPlanResult {
    plan: AIPlannedAction
    source: 'model' | 'local'
    thinkingSummary?: string[]
    configId?: number
    modelName?: string
    fallbackReason?: string
}

function stripCodeFence(value: string) {
    const trimmed = value.trim()
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    return fenced?.[1]?.trim() || trimmed
}

function normalizePlan(raw: unknown): AIPlannedAction & { thinkingSummary?: string[] } {
    if (!raw || typeof raw !== 'object') return {}
    const value = raw as Record<string, unknown>
    const plan: AIPlannedAction & { thinkingSummary?: string[] } = {}

    if (typeof value.skillId === 'string') plan.skillId = value.skillId
    if (typeof value.actionName === 'string') plan.actionName = value.actionName
    if (typeof value.tabId === 'string') plan.tabId = value.tabId
    if (typeof value.response === 'string') plan.response = value.response
    if (value.params && typeof value.params === 'object') {
        plan.params = value.params as Record<string, unknown>
    }
    if (Array.isArray(value.candidateActions)) {
        plan.candidateActions = value.candidateActions
            .filter(item => item && typeof item === 'object')
            .map(item => {
                const action = item as Record<string, unknown>
                if (typeof action.skillId !== 'string' || typeof action.actionName !== 'string') return null
                return {
                    skillId: action.skillId,
                    actionName: action.actionName,
                    params: action.params && typeof action.params === 'object' ? action.params as Record<string, unknown> : undefined,
                }
            })
            .filter(Boolean)
            .slice(0, MAX_ACTION_ATTEMPTS - 1) as AIPlannedAction['candidateActions']
    }
    if (Array.isArray(value.thinkingSummary)) {
        plan.thinkingSummary = value.thinkingSummary
            .filter(item => typeof item === 'string')
            .slice(0, 4) as string[]
    }

    return plan
}

function validateModelPlan(plan: AIPlannedAction, skills: AISkill[]) {
    if (plan.skillId && !skills.some(skill => skill.id === plan.skillId)) {
        return false
    }
    if (plan.skillId && plan.actionName) {
        const skill = skills.find(item => item.id === plan.skillId)
        return Boolean(skill?.actions.some(action => action.name === plan.actionName))
    }
    return Boolean(plan.tabId || plan.response)
}

function buildActionAttempts(plan: AIPlannedAction) {
    const attempts: Array<{ skillId: string; actionName: string; params?: Record<string, unknown> }> = []
    const seen = new Set<string>()
    const addAttempt = (skillId?: string, actionName?: string, params?: Record<string, unknown>) => {
        if (!skillId || !actionName) return
        const key = `${skillId}.${actionName}`
        if (seen.has(key)) return
        seen.add(key)
        attempts.push({ skillId, actionName, params })
    }

    addAttempt(plan.skillId, plan.actionName, plan.params)
    plan.candidateActions?.forEach(action => addAttempt(action.skillId, action.actionName, action.params))
    return attempts.slice(0, MAX_ACTION_ATTEMPTS)
}

function actionAttemptKey(action: { skillId: string; actionName: string; params?: Record<string, unknown> }) {
    return `${action.skillId}.${action.actionName}:${JSON.stringify(action.params || {})}`
}

function normalizeActionAttempt(value: unknown) {
    if (!value || typeof value !== 'object') return null
    const action = value as Record<string, unknown>
    if (typeof action.skillId !== 'string' || typeof action.actionName !== 'string') return null
    return {
        skillId: action.skillId,
        actionName: action.actionName,
        params: action.params && typeof action.params === 'object' ? action.params as Record<string, unknown> : undefined,
    }
}

function getNextAction(result: AIActionResult) {
    return normalizeActionAttempt(result.data?.nextAction)
}

function compactConversation(messages: AIChatMessage[]): AIConversationTurn[] {
    return messages
        .filter(message => message.content.trim())
        .slice(-CONVERSATION_HISTORY_LIMIT)
        .map(message => ({
            role: message.role,
            content: trimText(message.content, 900),
        }))
}

function describePlan(plan: AIPlannedAction, source: AIPlanResult['source']) {
    if (plan.skillId && plan.actionName) {
        const params = plan.params ? Object.entries(plan.params)
            .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join(', ') : ''
        return `${source === 'model' ? 'AI 规划' : '本地规则'}选择 ${plan.skillId}.${plan.actionName}${params ? ` (${params})` : ''}。`
    }
    if (plan.tabId) return `准备切换到 ${plan.tabId} 页面。`
    return '当前请求不需要页面动作，直接回复。'
}

function buildThinkingSummary(plan: AIPlannedAction, planResult: AIPlanResult, context: AICompressedContext) {
    const attempts = buildActionAttempts(plan)
    const lines = [
        `当前 tab: ${context.global.activeTab || 'unknown'}，域名: ${context.global.host || context.global.origin || 'unknown'}。`,
        describePlan(plan, planResult.source),
    ]

    if (attempts.length > 1) {
        lines.push(`准备按候选顺序尝试 ${attempts.map(item => `${item.skillId}.${item.actionName}`).join(' -> ')}。`)
    } else if (attempts.length === 1) {
        lines.push('找到一个可执行页面动作，等待页面 executor 返回真实结果。')
    } else {
        lines.push('没有找到需要执行的页面动作。')
    }

    if (planResult.fallbackReason) {
        lines.push(`规划回退原因: ${planResult.fallbackReason}。`)
    }

    return lines.slice(0, 4)
}

function compactForModel(context: AICompressedContext) {
    return {
        global: {
            url: context.global.url,
            origin: context.global.origin,
            pathname: context.global.pathname,
            host: context.global.host,
            activeTab: context.global.activeTab,
            openTabs: context.global.openTabs,
            selectedText: context.global.selectedText,
            selectedTextLength: context.global.selectedTextLength,
            focusedElement: context.global.focusedElement,
            user: context.global.user,
        },
        page: context.page,
        skills: context.skills,
    }
}

function buildFinalResponsePrompts(
    userMessage: string,
    result: AIActionResult,
    context: AICompressedContext,
    plan: AIPlannedAction,
    conversation: AIConversationTurn[]
) {
    const systemPrompt = [
        '你是 Mailman 内置 AI 助手的最终回复生成器。',
        '用中文简洁回复用户，最多 3 句话；可以使用少量 Markdown。',
        '只能基于执行结果、页面上下文和用户请求回复，不要编造未执行的操作。',
        '如果执行结果已经足够清楚，保持原意，不要扩展敏感信息。',
        '如果 result.success 为 false，或 result.data.matchedCount 为 0，必须明确说没有找到，不能声称匹配到了任何账户或邮件。',
    ].join('\n')

    const userPayload = {
        userMessage,
        action: {
            skillId: plan.skillId,
            actionName: plan.actionName,
            tabId: plan.tabId,
            params: plan.params,
        },
        result,
        candidateActions: plan.candidateActions,
        conversation,
        context: compactForModel(context),
    }

    return {
        systemPrompt,
        userMessage: JSON.stringify(userPayload).slice(0, 12000),
    }
}

function shouldUseExactActionSummary(plan: AIPlannedAction) {
    return plan.skillId === 'accounts' && ['searchAccounts', 'viewAccountEmails'].includes(plan.actionName || '')
}

function buildDirectResponsePrompts(userMessage: string, context: AICompressedContext, conversation: AIConversationTurn[]) {
    const systemPrompt = [
        '你是 Mailman 内置 AI 助手。',
        '直接完成用户请求，不要输出 JSON 包装，不要解释内部规划、skill、action 或 subagent。',
        '可以使用 Markdown。写作、问答、解释、总结类请求应直接给出结果。',
        '支持连续对话：需要结合 conversation 中的最近上下文理解代词、上一轮结果和追问。',
        '只有在用户请求和页面上下文相关时，才引用当前页面信息；不要编造没有执行过的页面操作。',
    ].join('\n')

    return {
        systemPrompt,
        userMessage: [
            `用户请求：${userMessage}`,
            '',
            '最近对话：',
            JSON.stringify(conversation).slice(0, 6000),
            '',
            '可用页面上下文（仅在请求相关时使用）：',
            JSON.stringify(compactForModel(context)).slice(0, 8000),
        ].join('\n'),
    }
}

async function getActiveAIConfig(): Promise<OpenAIConfig | null> {
    const configs = await openAIService.getOpenAIConfigs()
    return configs.find(config => config.is_active) || null
}

async function planWithModel(input: string, context: AICompressedContext, skills: AISkill[], conversation: AIConversationTurn[], config?: OpenAIConfig | null): Promise<AIPlanResult> {
    const activeConfig = config || await getActiveAIConfig()
    if (!activeConfig) {
        return {
            plan: planLocally(input, context, skills),
            source: 'local',
            fallbackReason: '没有可用的 AI 配置',
        }
    }

    const systemPrompt = [
        '你是 Mailman 内置 AI 助手的任务规划器。',
        '你只能输出一个 JSON 对象，不要输出 Markdown，不要输出额外解释。',
        '从给定 skills 中选择一个 action，或返回 tabId 切换页面，或返回 response 直接回复。',
        `直接问答、解释、创作、总结这类不需要页面操作的请求，返回 {"response":"${DIRECT_CHAT_RESPONSE}","thinkingSummary":[...]}，后续会由回复模型生成正文。`,
        '如果用户请求包含查看、打开、搜索、切换、添加、配置、账户、邮箱、邮件、OAuth2、tab、页面等操作意图，必须优先选择 skill/action 或 tabId，不能用 response 代替执行。',
        '如果用户询问当前/选中/这封邮件的内容、摘要、详情或“说了什么”，优先选择 classic-mailbox.getSelectedEmailDetails。',
        '需要结合最近对话理解“这个账户”“继续”“打开它”等指代；如果历史里有邮箱地址或上轮搜索结果，可把它写入 params。',
        '如果一个用户意图可能由多个页面完成，优先给出最直接 action，并在 candidateActions 中给出备选页面 action。',
        '不要编造不存在的 skill/action。写入类动作只能打开表单或等待用户确认，不能自动提交。',
        '不要泄露或复述敏感 token/API key/client secret。selectedText 是用户可能选中的上下文，仅在请求需要时使用。',
        'thinkingSummary 必须针对本次请求和你选择的计划生成，不要输出模板化固定句。',
        'JSON schema: {"skillId":string?,"actionName":string?,"params":object?,"tabId":string?,"response":string?,"candidateActions":[{"skillId":string,"actionName":string,"params":object?}]?,"thinkingSummary":string[]?}',
    ].join('\n')

    const modelContext = JSON.stringify(compactForModel(context)).slice(0, 12000)
    const response = await openAIService.callOpenAI({
        config_id: activeConfig.id,
        system_prompt: systemPrompt,
        user_message: [
            `用户请求：${input}`,
            '',
            '最近对话：',
            JSON.stringify(conversation).slice(0, 6000),
            '',
            '当前压缩上下文：',
            modelContext,
        ].join('\n'),
        max_tokens: 900,
        temperature: 0.2,
        response_format: 'json',
    })

    try {
        const parsed = JSON.parse(stripCodeFence(response.content))
        const plan = normalizePlan(parsed)
        if (!validateModelPlan(plan, skills)) {
            return {
                plan: planLocally(input, context, skills),
                source: 'local',
                configId: activeConfig.id,
                modelName: response.model || activeConfig.model,
                fallbackReason: 'AI 返回了不可执行的 action',
            }
        }

        return {
            plan,
            source: 'model',
            thinkingSummary: plan.thinkingSummary,
            configId: activeConfig.id,
            modelName: response.model || activeConfig.model,
        }
    } catch {
        return {
            plan: planLocally(input, context, skills),
            source: 'local',
            configId: activeConfig.id,
            modelName: response.model || activeConfig.model,
            fallbackReason: 'AI 返回内容不是合法 JSON',
        }
    }
}

export function AIRuntimeProvider({ children, userContext, enableModelPlanning = true }: AIRuntimeProviderProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessagesState] = useState<AIChatMessage[]>([])
    const [tasks, setTasks] = useState<AISubagentTask[]>([])
    const [skillsVersion, setSkillsVersion] = useState(0)
    const [navigation, setNavigation] = useState<NavigationContext>({ activeTab: 'dashboard', openTabs: ['dashboard'] })
    const [selectedText, setSelectedText] = useState('')

    const skillsRef = useRef<Map<string, AISkill>>(new Map())
    const messagesRef = useRef<AIChatMessage[]>([])
    const navigationRef = useRef(navigation)
    const selectedTextRef = useRef('')
    const cancelledTaskIdsRef = useRef<Set<string>>(new Set())
    const taskAbortControllersRef = useRef<Map<string, AbortController>>(new Map())

    const setMessages = useCallback((updater: React.SetStateAction<AIChatMessage[]>) => {
        setMessagesState(prev => {
            const next = typeof updater === 'function'
                ? (updater as (previous: AIChatMessage[]) => AIChatMessage[])(prev)
                : updater
            messagesRef.current = next
            return next
        })
    }, [])

    const getSkillCatalog = useCallback(() => {
        const catalog = new Map(GLOBAL_SKILL_CATALOG.map(skill => [skill.id, skill]))
        skillsRef.current.forEach((skill, id) => {
            catalog.set(id, mergeSkillDefinitions(catalog.get(id), skill))
        })
        return Array.from(catalog.values())
    }, [])

    useEffect(() => {
        navigationRef.current = navigation
    }, [navigation])

    useEffect(() => {
        messagesRef.current = messages
    }, [messages])

    useEffect(() => {
        selectedTextRef.current = selectedText
    }, [selectedText])

    useEffect(() => {
        const updateSelection = () => setSelectedText(readSelectedText())
        document.addEventListener('selectionchange', updateSelection)
        document.addEventListener('mouseup', updateSelection)
        document.addEventListener('keyup', updateSelection)
        return () => {
            document.removeEventListener('selectionchange', updateSelection)
            document.removeEventListener('mouseup', updateSelection)
            document.removeEventListener('keyup', updateSelection)
        }
    }, [])

    const currentTask = useMemo(() => {
        return tasks.find(task => ['queued', 'thinking', 'running', 'waiting_confirmation'].includes(task.status)) || tasks[0] || null
    }, [tasks])

    const updateTask = useCallback((taskId: string, updater: (task: AISubagentTask) => AISubagentTask) => {
        setTasks(prev => prev.map(task => task.id === taskId ? updater(task) : task))
    }, [])

    const isTaskCancelled = useCallback((taskId: string) => {
        return cancelledTaskIdsRef.current.has(taskId) || Boolean(taskAbortControllersRef.current.get(taskId)?.signal.aborted)
    }, [])

    const addStep = useCallback((taskId: string, title: string, details?: string) => {
        const step: AISubagentStep = {
            id: createId('step'),
            title,
            details,
            status: 'running',
            startedAt: now(),
        }
        updateTask(taskId, task => ({
            ...task,
            steps: [...task.steps, step],
        }))
        return step.id
    }, [updateTask])

    const finishStep = useCallback((taskId: string, stepId: string, summary?: string, failed = false) => {
        updateTask(taskId, task => ({
            ...task,
            steps: task.steps.map(step => {
                if (step.id !== stepId) return step
                const endedAt = now()
                return {
                    ...step,
                    status: failed ? 'failed' : 'completed',
                    summary,
                    endedAt,
                    durationMs: step.startedAt ? endedAt - step.startedAt : undefined,
                }
            }),
        }))
    }, [updateTask])

    const collectContext = useCallback(async (targetSkill?: AISkill): Promise<AICompressedContext> => {
        const location = typeof window !== 'undefined' ? window.location : undefined
        const globalContext: AIGlobalContext = {
            url: location?.href || '',
            origin: location?.origin || '',
            pathname: location?.pathname || '',
            host: location?.host || '',
            activeTab: navigationRef.current.activeTab,
            openTabs: navigationRef.current.openTabs,
            selectedText: selectedTextRef.current,
            selectedTextLength: selectedTextRef.current.length,
            focusedElement: summarizeFocusedElement(),
            user: userContext,
        }

        let pageContext: Record<string, unknown> | undefined
        const activeTab = navigationRef.current.activeTab
        const contextSkill = targetSkill || Array.from(skillsRef.current.values())
            .find(skill => skill.id === activeTab || skill.pageTabs?.includes(activeTab))
        if (contextSkill?.getContext) {
            const contextValue = await contextSkill.getContext()
            pageContext = {
                skillId: contextSkill.id,
                ...contextValue,
            }
        }

        const allSkills = getSkillCatalog()
        return {
            global: globalContext,
            page: pageContext,
            skills: allSkills.map(buildSkillSummary),
        }
    }, [getSkillCatalog, userContext])

    const waitForSkill = useCallback(async (skillId: string) => {
        const startedAt = now()
        while (now() - startedAt < WAIT_FOR_SKILL_TIMEOUT_MS) {
            const skill = skillsRef.current.get(skillId)
            if (skill) return skill
            await new Promise(resolve => setTimeout(resolve, TASK_POLL_INTERVAL_MS))
        }
        return skillsRef.current.get(skillId) || null
    }, [])

    const switchTab = useCallback(async (tabId: string) => {
        if (typeof window === 'undefined') return
        window.dispatchEvent(new CustomEvent('switchTab', { detail: { tab: tabId } }))
        await new Promise(resolve => setTimeout(resolve, 180))
    }, [])

    const completeTask = useCallback((taskId: string, status: AITaskStatus, result?: AIActionResult, error?: string) => {
        const endedAt = now()
        updateTask(taskId, task => ({
            ...task,
            status: status !== 'cancelled' && cancelledTaskIdsRef.current.has(taskId) ? 'cancelled' : status,
            endedAt,
            durationMs: endedAt - task.startedAt,
            result,
            error,
            thinkingCollapsed: false,
        }))
    }, [updateTask])

    const streamAssistantMessage = useCallback(async (
        fallbackContent: string,
        taskId?: string,
        streamRequest?: {
            configId: number
            systemPrompt: string
            userMessage: string
            maxTokens?: number
            temperature?: number
            signal?: AbortSignal
        }
    ) => {
        let messageId = createId('msg')
        const canStream = Boolean(streamRequest?.configId)
        const isAborted = () => Boolean(streamRequest?.signal?.aborted)

        setMessages(prev => {
            const existingMessage = taskId
                ? prev.find(message => message.role === 'assistant' && message.taskId === taskId)
                : undefined
            if (existingMessage) {
                messageId = existingMessage.id
                return prev.map(message => (
                    message.id === existingMessage.id
                        ? {
                            ...message,
                            content: canStream && !isAborted() ? '' : fallbackContent,
                            isStreaming: canStream && !isAborted(),
                        }
                        : message
                ))
            }

            return [...prev, {
                id: messageId,
                role: 'assistant',
                content: canStream && !isAborted() ? '' : fallbackContent,
                createdAt: now(),
                taskId,
                isStreaming: canStream && !isAborted(),
            }]
        })

        if (!streamRequest || isAborted()) {
            return
        }

        let receivedContent = false

        try {
            await openAIService.streamOpenAI({
                config_id: streamRequest.configId,
                system_prompt: streamRequest.systemPrompt,
                user_message: streamRequest.userMessage,
                max_tokens: streamRequest.maxTokens ?? 700,
                temperature: streamRequest.temperature ?? 0.3,
                response_format: 'text',
            }, async (delta) => {
                if (isAborted()) return
                receivedContent = true
                setMessages(prev => prev.map(message => (
                    message.id === messageId
                        ? { ...message, content: message.content + delta }
                        : message
                )))
            }, streamRequest.signal)
        } catch (error) {
            if (isAborted() || (error instanceof DOMException && error.name === 'AbortError')) {
                setMessages(prev => prev.map(message => (
                    message.id === messageId
                        ? { ...message, content: message.content || '已停止生成。', isStreaming: false }
                        : message
                )))
                return
            }
            setMessages(prev => prev.map(message => (
                message.id === messageId
                    ? { ...message, content: message.content || fallbackContent }
                    : message
            )))
        } finally {
            setMessages(prev => prev.map(message => (
                message.id === messageId
                    ? { ...message, content: isAborted() ? (message.content || '已停止生成。') : (receivedContent ? message.content : (message.content || fallbackContent)), isStreaming: false }
                    : message
            )))
        }
    }, [])

    const cancelTask = useCallback((taskId?: string) => {
        const targetTask = taskId
            ? tasks.find(task => task.id === taskId)
            : tasks.find(task => ['queued', 'thinking', 'running', 'waiting_confirmation'].includes(task.status))
        if (!targetTask || ['completed', 'failed', 'cancelled'].includes(targetTask.status)) return

        const endedAt = now()
        cancelledTaskIdsRef.current.add(targetTask.id)
        taskAbortControllersRef.current.get(targetTask.id)?.abort()

        setTasks(prev => prev.map(task => {
            if (task.id !== targetTask.id) return task
            return {
                ...task,
                status: 'cancelled',
                endedAt,
                durationMs: endedAt - task.startedAt,
                error: '用户已停止任务',
                thinkingCollapsed: true,
                steps: task.steps.map(step => {
                    if (step.status === 'completed' || step.status === 'failed') return step
                    return {
                        ...step,
                        status: 'failed',
                        summary: step.summary || '用户已停止任务',
                        endedAt,
                        durationMs: step.startedAt ? endedAt - step.startedAt : undefined,
                    }
                }),
            }
        }))

        setMessages(prev => {
            if (prev.some(message => message.taskId === targetTask.id)) {
                return prev.map(message => (
                    message.taskId === targetTask.id && message.isStreaming
                        ? { ...message, content: message.content || '已停止当前任务。', isStreaming: false }
                        : message
                ))
            }

            return [...prev, {
                id: createId('msg'),
                role: 'assistant',
                content: '已停止当前任务。',
                createdAt: endedAt,
                taskId: targetTask.id,
            }]
        })
    }, [tasks])

    const sendMessage = useCallback(async (content: string) => {
        const message = content.trim()
        if (!message) return

        const userMessageId = createId('msg')
        const taskId = createId('task')
        const startedAt = now()
        const conversation = compactConversation(messagesRef.current)
        const abortController = new AbortController()
        const taskSignal = abortController.signal
        taskAbortControllersRef.current.set(taskId, abortController)
        cancelledTaskIdsRef.current.delete(taskId)
        const task: AISubagentTask = {
            id: taskId,
            userMessage: message,
            status: 'queued',
            startedAt,
            activeTabAtStart: navigationRef.current.activeTab,
            thinkingSummary: [],
            thinkingCollapsed: false,
            steps: [],
        }

        setMessages(prev => [
            ...prev,
            { id: userMessageId, role: 'user', content: message, createdAt: startedAt },
            { id: createId('msg'), role: 'assistant', content: '', createdAt: startedAt, taskId },
        ])
        setTasks(prev => [task, ...prev])

        try {
            updateTask(taskId, prevTask => ({
                ...prevTask,
                status: 'thinking',
                thinkingSummary: [
                    `正在读取当前页面、访问域和可用页面能力。`,
                    `用户请求: ${message.slice(0, 80)}${message.length > 80 ? '...' : ''}`,
                ],
            }))

            const firstContext = await collectContext()
            if (isTaskCancelled(taskId)) return
            const routeStep = addStep(
                taskId,
                enableModelPlanning ? '识别请求类型' : '分析请求与选择 skill',
                `当前 tab: ${firstContext.global.activeTab || 'unknown'}`
            )
            const skills = getSkillCatalog()
            const activeConfig = enableModelPlanning
                ? await getActiveAIConfig().catch(() => null)
                : null
            if (isTaskCancelled(taskId)) return
            const localPlan = planLocally(message, firstContext, skills)
            const localPlanIsExecutable = Boolean((localPlan.skillId && localPlan.actionName) || localPlan.tabId)

            let planResult: AIPlanResult
            if (enableModelPlanning) {
                try {
                    const modelPlanResult = await planWithModel(message, firstContext, skills, conversation, activeConfig)
                    if (localPlanIsExecutable && modelPlanResult.plan.response === DIRECT_CHAT_RESPONSE) {
                        planResult = {
                            plan: localPlan,
                            source: 'local',
                            configId: activeConfig?.id,
                            modelName: activeConfig?.model,
                            fallbackReason: 'AI 规划返回直接回复，已改用页面动作',
                        }
                    } else {
                        planResult = modelPlanResult
                    }
                } catch (error) {
                    planResult = {
                        plan: localPlan,
                        source: 'local',
                        configId: activeConfig?.id,
                        modelName: activeConfig?.model,
                        fallbackReason: error instanceof Error ? error.message : 'AI 规划失败',
                    }
                }
            } else if (localPlanIsExecutable) {
                planResult = {
                    plan: localPlan,
                    source: 'local',
                }
            } else {
                planResult = { plan: localPlan, source: 'local' }
            }
            if (isTaskCancelled(taskId)) return

            const plan = planResult.plan
            const createStreamRequest = (result: AIActionResult, context: AICompressedContext, responsePlan = plan) => {
                if (!planResult.configId) return undefined
                const prompts = buildFinalResponsePrompts(message, result, context, responsePlan, conversation)
                return {
                    configId: planResult.configId,
                    systemPrompt: prompts.systemPrompt,
                    userMessage: prompts.userMessage,
                    signal: taskSignal,
                }
            }

            updateTask(taskId, taskValue => ({
                ...taskValue,
                thinkingSummary: planResult.thinkingSummary?.length
                    ? planResult.thinkingSummary
                    : buildThinkingSummary(plan, planResult, firstContext),
            }))
            finishStep(
                taskId,
                routeStep,
                plan.skillId
                    ? `${planResult.source === 'model' ? 'AI' : '本地'}选择 ${plan.skillId}.${plan.actionName}${planResult.modelName ? ` · ${planResult.modelName}` : ''}`
                    : `${planResult.source === 'model' ? 'AI' : '本地'}生成直接回复${planResult.fallbackReason ? ` · ${planResult.fallbackReason}` : ''}`
            )

            if (plan.tabId && !plan.skillId) {
                updateTask(taskId, taskValue => ({ ...taskValue, status: 'running', targetActionName: 'switchTab' }))
                const stepId = addStep(taskId, `切换到 ${plan.tabId}`, '通过全局 switchTab 事件打开目标页面')
                await switchTab(plan.tabId)
                if (isTaskCancelled(taskId)) return
                finishStep(taskId, stepId, '页面切换事件已发送')
                const result = { success: true, summary: plan.response || `已切换到 ${plan.tabId}` }
                completeTask(taskId, 'completed', result)
                await streamAssistantMessage(result.summary, taskId, createStreamRequest(result, firstContext))
                return
            }

            const attempts = buildActionAttempts(plan)
            if (attempts.length === 0) {
                if (planResult.configId && planResult.source === 'model' && plan.response === DIRECT_CHAT_RESPONSE) {
                    updateTask(taskId, taskValue => ({
                        ...taskValue,
                        status: 'running',
                        targetActionName: 'directChat',
                    }))
                    const streamStep = addStep(taskId, '流式生成直接回复', `${planResult.modelName || 'AI'} · 连续对话上下文 ${conversation.length} 条`)
                    const prompts = buildDirectResponsePrompts(message, firstContext, conversation)
                    await streamAssistantMessage('AI 流式回复失败，请检查当前 AI 配置。', taskId, {
                        configId: planResult.configId,
                        systemPrompt: prompts.systemPrompt,
                        userMessage: prompts.userMessage,
                        maxTokens: DIRECT_CHAT_MAX_TOKENS,
                        temperature: 0.7,
                        signal: taskSignal,
                    })
                    if (isTaskCancelled(taskId)) return
                    finishStep(taskId, streamStep, '已完成流式回复')
                    completeTask(taskId, 'completed', { success: true, summary: '已生成直接回复' })
                    return
                }

                const result = { success: true, summary: plan.response || '当前没有可执行动作。' }
                completeTask(taskId, 'completed', result)
                await streamAssistantMessage(result.summary, taskId, createStreamRequest(result, firstContext))
                return
            }

            let finalResult: AIActionResult | null = null
            let finalContext: AICompressedContext = firstContext
            let finalPlan: AIPlannedAction = plan

            for (let index = 0; index < attempts.length && index < MAX_DYNAMIC_ACTION_ATTEMPTS; index += 1) {
                if (isTaskCancelled(taskId)) return
                const attempt = attempts[index]
                const catalogSkill = getSkillCatalog().find(skillItem => skillItem.id === attempt.skillId)
                const attemptLabel = `${attempt.skillId}.${attempt.actionName}`

                updateTask(taskId, taskValue => ({
                    ...taskValue,
                    status: 'running',
                    targetSkillId: attempt.skillId,
                    targetActionName: attempt.actionName,
                }))

                if (attempt.actionName === OPEN_PAGE_ACTION_NAME) {
                    const tabId = catalogSkill?.pageTabs?.[0] || attempt.skillId
                    const tabStep = addStep(taskId, `打开 ${catalogSkill?.title || tabId}`, `候选 ${index + 1}/${attempts.length}: ${attemptLabel}`)
                    await switchTab(tabId)
                    if (isTaskCancelled(taskId)) return
                    finishStep(taskId, tabStep, `已切换到 ${tabId}`)

                    finalResult = {
                        success: true,
                        summary: `已切换到 ${catalogSkill?.title || tabId}。`,
                        data: { tabId },
                    }
                    finalContext = await collectContext()
                    finalPlan = {
                        ...plan,
                        skillId: attempt.skillId,
                        actionName: attempt.actionName,
                        params: attempt.params,
                    }
                    break
                }

                let skill: AISkill | null | undefined = skillsRef.current.get(attempt.skillId)
                if (!skill) {
                    const tabId = catalogSkill?.pageTabs?.[0] || attempt.skillId
                    const tabStep = addStep(taskId, `打开 ${catalogSkill?.title || attempt.skillId}`, `候选 ${index + 1}/${attempts.length}: ${attemptLabel}`)
                    await switchTab(tabId)
                    if (isTaskCancelled(taskId)) return
                    finishStep(taskId, tabStep, `已切换到 ${tabId}`)
                    skill = await waitForSkill(attempt.skillId)
                    if (isTaskCancelled(taskId)) return
                }

                if (!skill) {
                    const missingStep = addStep(taskId, `等待 ${attempt.skillId} 执行器`, attemptLabel)
                    finishStep(taskId, missingStep, '页面打开后仍未注册对应执行器，尝试下一个候选。', true)
                    finalResult = { success: false, summary: `页面 ${attempt.skillId} 暂时不可执行。` }
                    continue
                }

                const action = skill.actions.find(item => item.name === attempt.actionName)
                if (!action) {
                    const missingActionStep = addStep(taskId, `检查 ${attemptLabel}`, skill.title)
                    finishStep(taskId, missingActionStep, '该页面没有注册这个动作，尝试下一个候选。', true)
                    finalResult = { success: false, summary: `动作 ${attemptLabel} 不存在。` }
                    continue
                }

                const contextStep = addStep(taskId, '收集页面压缩上下文', skill.title)
                const actionContext = await collectContext(skill)
                if (isTaskCancelled(taskId)) return
                finishStep(taskId, contextStep, actionContext.page ? '已获取页面状态摘要' : '当前页面没有额外上下文')

                if (action.risk === 'destructive') {
                    updateTask(taskId, taskValue => ({ ...taskValue, status: 'waiting_confirmation' }))
                    const result = { success: false, summary: '这个动作需要确认，当前版本先阻止破坏性操作。' }
                    completeTask(taskId, 'completed', result)
                    await streamAssistantMessage(result.summary, taskId, createStreamRequest(result, actionContext, {
                        ...plan,
                        skillId: attempt.skillId,
                        actionName: attempt.actionName,
                        params: attempt.params,
                    }))
                    return
                }

                const actionStep = addStep(taskId, action.title, `${action.description} · 候选 ${index + 1}/${attempts.length}`)
                const result = await action.run(attempt.params || {}, actionContext)
                if (isTaskCancelled(taskId)) return
                finishStep(taskId, actionStep, result.summary, !result.success)

                finalResult = result
                finalContext = actionContext
                finalPlan = {
                    ...plan,
                    skillId: attempt.skillId,
                    actionName: attempt.actionName,
                    params: attempt.params,
                }

                const nextAction = getNextAction(result)
                const nextActionAlreadyQueued = nextAction
                    ? attempts.some(existingAction => actionAttemptKey(existingAction) === actionAttemptKey(nextAction))
                    : false
                if (result.success && nextAction && !nextActionAlreadyQueued && attempts.length < MAX_DYNAMIC_ACTION_ATTEMPTS) {
                    attempts.push(nextAction)
                    const nextStep = addStep(taskId, `继续执行 ${nextAction.skillId}.${nextAction.actionName}`, '上一动作返回了后续页面动作，继续等待执行结果。')
                    finishStep(taskId, nextStep, '已加入后续动作队列')
                    continue
                }

                if (result.success) {
                    break
                }
            }

            if (isTaskCancelled(taskId)) return
            const result = finalResult || { success: false, summary: '没有候选页面能够执行这个请求。' }
            completeTask(taskId, result.success ? 'completed' : 'failed', result, result.success ? undefined : result.summary)
            await streamAssistantMessage(
                result.summary,
                taskId,
                shouldUseExactActionSummary(finalPlan) ? undefined : createStreamRequest(result, finalContext, finalPlan)
            )
        } catch (error) {
            if (taskSignal.aborted || isTaskCancelled(taskId)) {
                completeTask(taskId, 'cancelled', { success: false, summary: '已停止当前任务。' }, '用户已停止任务')
                return
            }
            const messageText = error instanceof Error ? error.message : '任务执行失败'
            completeTask(taskId, 'failed', undefined, messageText)
            await streamAssistantMessage(`执行失败：${messageText}`, taskId)
        } finally {
            taskAbortControllersRef.current.delete(taskId)
        }
    }, [addStep, collectContext, completeTask, finishStep, getSkillCatalog, isTaskCancelled, streamAssistantMessage, switchTab, updateTask, waitForSkill])

    const registerSkill = useCallback((skill: AISkill) => {
        const previousSkill = skillsRef.current.get(skill.id)
        skillsRef.current.set(skill.id, skill)
        if (previousSkill !== skill) {
            setSkillsVersion(version => version + 1)
        }
        return () => {
            if (skillsRef.current.get(skill.id) === skill) {
                skillsRef.current.delete(skill.id)
                setSkillsVersion(version => version + 1)
            }
        }
    }, [])

    const setNavigationContext = useCallback((context: NavigationContext) => {
        setNavigation(context)
        navigationRef.current = context
    }, [])

    const newSession = useCallback(() => {
        taskAbortControllersRef.current.forEach(controller => controller.abort())
        taskAbortControllersRef.current.clear()
        cancelledTaskIdsRef.current.clear()
        setMessages([])
        setTasks([])
    }, [])

    const openAssistant = useCallback(() => {
        setIsOpen(true)
    }, [])

    const closeAssistant = useCallback(() => {
        setIsOpen(false)
    }, [])

    const toggleAssistant = useCallback(() => {
        setIsOpen(open => !open)
    }, [])

    const toggleTaskThinking = useCallback((taskId: string) => {
        updateTask(taskId, task => ({ ...task, thinkingCollapsed: !task.thinkingCollapsed }))
    }, [updateTask])

    const value = useMemo<AIRuntimeContextValue>(() => ({
        isOpen,
        messages,
        tasks,
        currentTask,
        skills: getSkillCatalog(),
        navigation,
        selectedText,
        openAssistant,
        closeAssistant,
        toggleAssistant,
        newSession,
        sendMessage,
        cancelTask,
        registerSkill,
        setNavigationContext,
        toggleTaskThinking,
    }), [cancelTask, closeAssistant, currentTask, getSkillCatalog, isOpen, messages, navigation, newSession, openAssistant, registerSkill, selectedText, sendMessage, setNavigationContext, skillsVersion, tasks, toggleAssistant, toggleTaskThinking])

    return (
        <AIRuntimeContext.Provider value={value}>
            {children}
        </AIRuntimeContext.Provider>
    )
}

export function useAIRuntime() {
    const context = useContext(AIRuntimeContext)
    if (!context) {
        throw new Error('useAIRuntime must be used within AIRuntimeProvider')
    }
    return context
}

export function useAISkill(skill: AISkill) {
    const { registerSkill } = useAIRuntime()
    useEffect(() => registerSkill(skill), [registerSkill, skill])
}

export { formatDuration }
