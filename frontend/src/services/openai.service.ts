import { apiClient } from '@/lib/api-client'
import type {
    OpenAIConfig,
    OpenAIConfigRequest,
    AIPromptTemplate,
    AIPromptTemplateRequest,
    GenerateEmailTemplateRequest,
    GenerateEmailTemplateResponse,
    CallOpenAIRequest,
    CallOpenAIResponse
} from '@/types/openai'

const AI_CALL_TIMEOUT_MS = 600_000

export const openAIService = {
    // OpenAI Configuration methods
    async getOpenAIConfigs(): Promise<OpenAIConfig[]> {
        const response = await apiClient.get('/openai/configs')
        return response
    },

    async getOpenAIConfig(id: number): Promise<OpenAIConfig> {
        const response = await apiClient.get(`/openai/configs/${id}`)
        return response
    },

    async createOpenAIConfig(config: OpenAIConfigRequest): Promise<OpenAIConfig> {
        const response = await apiClient.post('/openai/configs', config)
        return response
    },

    async updateOpenAIConfig(id: number, config: OpenAIConfigRequest): Promise<OpenAIConfig> {
        const response = await apiClient.put(`/openai/configs/${id}`, config)
        return response
    },

    async deleteOpenAIConfig(id: number): Promise<void> {
        await apiClient.delete(`/openai/configs/${id}`)
    },

    // AI Prompt Template methods
    async getPromptTemplates(): Promise<AIPromptTemplate[]> {
        const response = await apiClient.get('/openai/prompt-templates')
        return response
    },

    async getPromptTemplate(id: number): Promise<AIPromptTemplate> {
        const response = await apiClient.get(`/openai/prompt-templates/${id}`)
        return response
    },

    async createPromptTemplate(template: AIPromptTemplateRequest): Promise<AIPromptTemplate> {
        const response = await apiClient.post('/openai/prompt-templates', template)
        return response
    },

    async updatePromptTemplate(id: number, template: AIPromptTemplateRequest): Promise<AIPromptTemplate> {
        const response = await apiClient.put(`/openai/prompt-templates/${id}`, template)
        return response
    },

    async deletePromptTemplate(id: number): Promise<void> {
        await apiClient.delete(`/openai/prompt-templates/${id}`)
    },

    // AI Generation methods
    async generateEmailTemplate(request: GenerateEmailTemplateRequest): Promise<GenerateEmailTemplateResponse> {
        const response = await apiClient.post('/openai/generate-template', request)
        return response
    },

    async initializeDefaultTemplates(): Promise<{ message: string }> {
        const response = await apiClient.post('/openai/initialize-templates')
        return response
    },

    // Call OpenAI API method
    async callOpenAI(request: CallOpenAIRequest): Promise<CallOpenAIResponse> {
        const response = await apiClient.post('/openai/call', request, { timeout: AI_CALL_TIMEOUT_MS })
        return response
    },

    async streamOpenAI(
        request: CallOpenAIRequest,
        onDelta: (delta: string) => void | Promise<void>,
        signal?: AbortSignal
    ): Promise<void> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
        }
        const token = typeof window !== 'undefined'
            ? localStorage.getItem('auth_token') || localStorage.getItem('sessionToken') || localStorage.getItem('token')
            : null
        if (token) {
            headers.Authorization = `Bearer ${token}`
        }

        const response = await fetch(apiClient.getFullUrl('/openai/call/stream'), {
            method: 'POST',
            headers,
            body: JSON.stringify(request),
            signal,
        })

        if (!response.ok) {
            const message = await response.text()
            throw new Error(message || `Stream request failed: ${response.status}`)
        }
        if (!response.body) {
            throw new Error('Stream response body is empty')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        const handleLine = async (line: string) => {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data:')) return false

            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') return true

            const event = JSON.parse(data) as { type?: string; content?: string; error?: string }
            if (event.type === 'error') {
                throw new Error(event.error || 'Stream failed')
            }
            if (event.type === 'done') {
                return true
            }
            if (event.type === 'delta' && event.content) {
                await onDelta(event.content)
            }
            return false
        }

        while (true) {
            if (signal?.aborted) {
                await reader.cancel().catch(() => undefined)
                return
            }
            const { value, done } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split(/\r?\n/)
            buffer = lines.pop() || ''

            for (const line of lines) {
                if (await handleLine(line)) {
                    return
                }
            }
        }

        buffer += decoder.decode()
        if (buffer.trim() && await handleLine(buffer)) {
            return
        }
    },

    // Test OpenAI configuration
    async testOpenAIConfig(config: OpenAIConfigRequest): Promise<{
        success: boolean
        message: string
        response?: string
        response_time_ms: number
        channel_type: string
        model: string
        tokens_used?: number
    }> {
        const response = await apiClient.post('/openai/test-config', config)
        return response
    }
}
