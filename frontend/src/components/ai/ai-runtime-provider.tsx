'use client'

import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { openAIService } from '@/services/openai.service'
import {
    AIActionResult,
    AIChatMessage,
    AICompressedContext,
    AIGlobalContext,
    AIPlannedAction,
    AISkill,
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
    registerSkill: (skill: AISkill) => () => void
    setNavigationContext: (context: NavigationContext) => void
    toggleTaskThinking: (taskId: string) => void
}

const AIRuntimeContext = createContext<AIRuntimeContextValue | null>(null)

const TASK_POLL_INTERVAL_MS = 80
const WAIT_FOR_SKILL_TIMEOUT_MS = 4000
const SELECTED_TEXT_LIMIT = 1200
const STREAM_CHUNK_DELAY_MS = 14

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

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function splitStreamingChunks(value: string) {
    const chars = Array.from(value)
    const chunkSize = chars.length > 700 ? 18 : chars.length > 240 ? 10 : 5
    const chunks: string[] = []
    for (let index = 0; index < chars.length; index += chunkSize) {
        chunks.push(chars.slice(index, index + chunkSize).join(''))
    }
    return chunks
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
        .replace(/\s*(邮箱账户|邮箱|账户|账号)$/i, '')
        .trim()
}

function inferSearchQuery(input: string, selectedText: string) {
    const quoted = input.match(/[“"']([^“"']{1,160})[”"']/)
    if (quoted?.[1]) return normalizeQuery(quoted[1])

    const searchMatch = input.match(/(?:搜索|查找|查询|找一下|帮我查|帮我搜索|search)\s*[:：]?\s*(.{1,180})/i)
    if (searchMatch?.[1]) return normalizeQuery(searchMatch[1])

    const emailMatch = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
    if (emailMatch?.[0]) return emailMatch[0]

    if (selectedText) return normalizeQuery(selectedText)
    return ''
}

function planLocally(input: string, context: AICompressedContext, skills: AISkill[]): AIPlannedAction {
    const lower = input.toLowerCase()
    const activeTab = context.global.activeTab
    const selectedText = context.global.selectedText
    const hasAccountsSkill = skills.some(skill => skill.id === 'accounts')
    const accountsIntent = hasAccountsSkill || /(邮箱账户|邮箱账号|账户管理|账号管理|mail accounts?|accounts?)/i.test(input) || activeTab === 'accounts'

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
        response: '我已经感知到当前页面，但这个请求还没有对应的页面 skill。可以先试试“搜索 xxx 邮箱账户”“添加账户”或“打开 OAuth2 配置”。'
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

async function planWithModel(input: string, context: AICompressedContext, skills: AISkill[]): Promise<AIPlanResult> {
    const configs = await openAIService.getOpenAIConfigs()
    const activeConfig = configs.find(config => config.is_active)
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
        '不要编造不存在的 skill/action。写入类动作只能打开表单或等待用户确认，不能自动提交。',
        '不要泄露或复述敏感 token/API key/client secret。selectedText 是用户可能选中的上下文，仅在请求需要时使用。',
        'JSON schema: {"skillId":string?,"actionName":string?,"params":object?,"tabId":string?,"response":string?,"thinkingSummary":string[]?}',
    ].join('\n')

    const modelContext = JSON.stringify(compactForModel(context)).slice(0, 12000)
    const response = await openAIService.callOpenAI({
        config_id: activeConfig.id,
        system_prompt: systemPrompt,
        user_message: `用户请求：${input}\n\n当前压缩上下文：\n${modelContext}`,
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
                modelName: response.model || activeConfig.model,
                fallbackReason: 'AI 返回了不可执行的 action',
            }
        }

        return {
            plan,
            source: 'model',
            thinkingSummary: plan.thinkingSummary,
            modelName: response.model || activeConfig.model,
        }
    } catch {
        return {
            plan: planLocally(input, context, skills),
            source: 'local',
            modelName: response.model || activeConfig.model,
            fallbackReason: 'AI 返回内容不是合法 JSON',
        }
    }
}

export function AIRuntimeProvider({ children, userContext, enableModelPlanning = true }: AIRuntimeProviderProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState<AIChatMessage[]>([])
    const [tasks, setTasks] = useState<AISubagentTask[]>([])
    const [skillsVersion, setSkillsVersion] = useState(0)
    const [navigation, setNavigation] = useState<NavigationContext>({ activeTab: 'dashboard', openTabs: ['dashboard'] })
    const [selectedText, setSelectedText] = useState('')

    const skillsRef = useRef<Map<string, AISkill>>(new Map())
    const navigationRef = useRef(navigation)
    const selectedTextRef = useRef('')

    useEffect(() => {
        navigationRef.current = navigation
    }, [navigation])

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
        if (targetSkill?.getContext) {
            pageContext = await targetSkill.getContext()
        }

        const allSkills = Array.from(skillsRef.current.values())
        return {
            global: globalContext,
            page: pageContext,
            skills: allSkills.map(buildSkillSummary),
        }
    }, [userContext])

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
            status,
            endedAt,
            durationMs: endedAt - task.startedAt,
            result,
            error,
            thinkingCollapsed: true,
        }))
    }, [updateTask])

    const streamAssistantMessage = useCallback(async (content: string, taskId?: string) => {
        const messageId = createId('msg')
        const chunks = splitStreamingChunks(content)

        setMessages(prev => [...prev, {
            id: messageId,
            role: 'assistant',
            content: '',
            createdAt: now(),
            taskId,
            isStreaming: true,
        }])

        if (chunks.length === 0) {
            setMessages(prev => prev.map(message => message.id === messageId ? { ...message, isStreaming: false } : message))
            return
        }

        for (const chunk of chunks) {
            await wait(STREAM_CHUNK_DELAY_MS)
            setMessages(prev => prev.map(message => (
                message.id === messageId
                    ? { ...message, content: message.content + chunk }
                    : message
            )))
        }

        setMessages(prev => prev.map(message => message.id === messageId ? { ...message, isStreaming: false } : message))
    }, [])

    const sendMessage = useCallback(async (content: string) => {
        const message = content.trim()
        if (!message) return

        const userMessageId = createId('msg')
        const taskId = createId('task')
        const startedAt = now()
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
        ])
        setTasks(prev => [task, ...prev])

        try {
            updateTask(taskId, prevTask => ({
                ...prevTask,
                status: 'thinking',
                thinkingSummary: [
                    '读取当前访问域、页面 tab、选中文本和已注册页面 skill。',
                    '压缩上下文，只保留当前任务需要的页面状态。',
                    '选择一个受控 action，由页面 executor 执行。',
                ],
            }))

            const firstContext = await collectContext()
            const routeStep = addStep(
                taskId,
                enableModelPlanning ? '调用 AI 规划动作' : '分析请求与选择 skill',
                `当前 tab: ${firstContext.global.activeTab || 'unknown'}`
            )
            const skills = Array.from(skillsRef.current.values())
            let planResult: AIPlanResult
            if (enableModelPlanning) {
                try {
                    planResult = await planWithModel(message, firstContext, skills)
                } catch (error) {
                    planResult = {
                        plan: planLocally(message, firstContext, skills),
                        source: 'local',
                        fallbackReason: error instanceof Error ? error.message : 'AI 规划失败',
                    }
                }
            } else {
                planResult = { plan: planLocally(message, firstContext, skills), source: 'local' }
            }

            const plan = planResult.plan
            updateTask(taskId, taskValue => ({
                ...taskValue,
                thinkingSummary: planResult.thinkingSummary?.length
                    ? planResult.thinkingSummary
                    : [
                        planResult.source === 'model' ? '调用已配置 AI 模型生成结构化 action。' : 'AI 规划不可用，使用本地规则生成结构化 action。',
                        '只保留当前页面和已注册 skill 的压缩上下文。',
                        '由页面 executor 执行最终 action。',
                    ],
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
                finishStep(taskId, stepId, '页面切换事件已发送')
                const result = { success: true, summary: plan.response || `已切换到 ${plan.tabId}` }
                completeTask(taskId, 'completed', result)
                await streamAssistantMessage(result.summary, taskId)
                return
            }

            if (!plan.skillId || !plan.actionName) {
                const result = { success: true, summary: plan.response || '当前没有可执行动作。' }
                completeTask(taskId, 'completed', result)
                await streamAssistantMessage(result.summary, taskId)
                return
            }

            updateTask(taskId, taskValue => ({
                ...taskValue,
                status: 'running',
                targetSkillId: plan.skillId,
                targetActionName: plan.actionName,
            }))

            let skill: AISkill | null | undefined = skillsRef.current.get(plan.skillId)
            if (!skill) {
                const tabStep = addStep(taskId, `打开 ${plan.skillId} 页面`, '目标 skill 尚未挂载，先切换到对应页面')
                await switchTab(plan.skillId)
                finishStep(taskId, tabStep, '已发送页面切换事件')
                skill = await waitForSkill(plan.skillId)
            }

            if (!skill) {
                throw new Error(`页面 skill ${plan.skillId} 未注册`)
            }

            const contextStep = addStep(taskId, '收集页面压缩上下文', skill.title)
            const actionContext = await collectContext(skill)
            finishStep(taskId, contextStep, actionContext.page ? '已获取页面状态摘要' : '当前页面没有额外上下文')

            const action = skill.actions.find(item => item.name === plan.actionName)
            if (!action) {
                throw new Error(`动作 ${plan.actionName} 不存在`)
            }

            if (action.risk === 'destructive') {
                updateTask(taskId, taskValue => ({ ...taskValue, status: 'waiting_confirmation' }))
                const result = { success: false, summary: '这个动作需要确认，当前版本先阻止破坏性操作。' }
                completeTask(taskId, 'completed', result)
                await streamAssistantMessage(result.summary, taskId)
                return
            }

            const actionStep = addStep(taskId, action.title, action.description)
            const result = await action.run(plan.params || {}, actionContext)
            finishStep(taskId, actionStep, result.summary, !result.success)
            completeTask(taskId, result.success ? 'completed' : 'failed', result, result.success ? undefined : result.summary)
            await streamAssistantMessage(result.summary, taskId)
        } catch (error) {
            const messageText = error instanceof Error ? error.message : '任务执行失败'
            completeTask(taskId, 'failed', undefined, messageText)
            await streamAssistantMessage(`执行失败：${messageText}`, taskId)
        }
    }, [addStep, collectContext, completeTask, finishStep, streamAssistantMessage, switchTab, updateTask, waitForSkill])

    const registerSkill = useCallback((skill: AISkill) => {
        skillsRef.current.set(skill.id, skill)
        setSkillsVersion(version => version + 1)
        return () => {
            skillsRef.current.delete(skill.id)
            setSkillsVersion(version => version + 1)
        }
    }, [])

    const setNavigationContext = useCallback((context: NavigationContext) => {
        setNavigation(context)
        navigationRef.current = context
    }, [])

    const newSession = useCallback(() => {
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
        skills: Array.from(skillsRef.current.values()),
        navigation,
        selectedText,
        openAssistant,
        closeAssistant,
        toggleAssistant,
        newSession,
        sendMessage,
        registerSkill,
        setNavigationContext,
        toggleTaskThinking,
    }), [closeAssistant, currentTask, isOpen, messages, navigation, newSession, openAssistant, registerSkill, selectedText, sendMessage, setNavigationContext, skillsVersion, tasks, toggleAssistant, toggleTaskThinking])

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
