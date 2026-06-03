'use client'

export type AIStepStatus = 'pending' | 'running' | 'completed' | 'failed'

export type AITaskStatus =
    | 'queued'
    | 'thinking'
    | 'running'
    | 'waiting_confirmation'
    | 'completed'
    | 'failed'
    | 'cancelled'

export type AIRiskLevel = 'read' | 'navigation' | 'write' | 'destructive'

export interface AIGlobalContext {
    url: string
    origin: string
    pathname: string
    host: string
    activeTab: string
    openTabs: string[]
    selectedText: string
    selectedTextLength: number
    focusedElement?: {
        tagName: string
        type?: string
        placeholder?: string
        ariaLabel?: string
        text?: string
    }
    user?: {
        id?: number
        username?: string
        email?: string
        isSuperAdmin?: boolean
    }
}

export interface AICompressedContext {
    global: AIGlobalContext
    page?: Record<string, unknown>
    skills: Array<{
        id: string
        title: string
        description: string
        actions: Array<{
            name: string
            title: string
            description: string
            risk: AIRiskLevel
        }>
    }>
}

export interface AIActionResult {
    success: boolean
    summary: string
    details?: string
    data?: Record<string, unknown>
}

export interface AISkillAction {
    name: string
    title: string
    description: string
    risk: AIRiskLevel
    parameters?: Record<string, string | undefined>
    run: (params: Record<string, unknown>, context: AICompressedContext) => Promise<AIActionResult> | AIActionResult
}

export interface AISkill {
    id: string
    title: string
    description: string
    aliases?: string[]
    pageTabs?: string[]
    getContext?: () => Promise<Record<string, unknown>> | Record<string, unknown>
    actions: AISkillAction[]
}

export interface AISubagentStep {
    id: string
    title: string
    status: AIStepStatus
    summary?: string
    details?: string
    startedAt?: number
    endedAt?: number
    durationMs?: number
}

export interface AISubagentTask {
    id: string
    userMessage: string
    status: AITaskStatus
    startedAt: number
    endedAt?: number
    durationMs?: number
    activeTabAtStart: string
    targetSkillId?: string
    targetActionName?: string
    thinkingSummary: string[]
    thinkingCollapsed: boolean
    steps: AISubagentStep[]
    result?: AIActionResult
    error?: string
}

export interface AIChatMessage {
    id: string
    role: 'user' | 'assistant'
    content: string
    createdAt: number
    taskId?: string
    isStreaming?: boolean
}

export interface AIPlannedAction {
    skillId?: string
    actionName?: string
    params?: Record<string, unknown>
    tabId?: string
    response?: string
    candidateActions?: Array<{
        skillId: string
        actionName: string
        params?: Record<string, unknown>
    }>
}
