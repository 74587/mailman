'use client'

import { useEffect, useMemo, useRef } from 'react'
import { AIRuntimeProvider, GlobalAIAssistant, useAIRuntime, useAISkill, type AISkill } from '@/components/ai'

export default function AIAssistantRegressionClient() {
    return (
        <AIRuntimeProvider enableModelPlanning={false}>
            <AIAssistantRegressionContent />
        </AIRuntimeProvider>
    )
}

function AIAssistantRegressionContent() {
    const { openAssistant, setNavigationContext } = useAIRuntime()
    const initializedRef = useRef(false)

    const skill = useMemo<AISkill>(() => ({
        id: 'accounts',
        title: '邮箱账户管理',
        description: 'AI regression harness for account page actions.',
        pageTabs: ['accounts'],
        getContext: () => ({
            searchQuery: '',
            submittedSearchQuery: '',
            providerFilter: null,
            visibleAccountsCount: 2,
            total: 2,
            sampleVisibleAccounts: [
                { id: 1, email: 'alpha@example.com', provider: 'gmail', authType: 'oauth2', isVerified: true },
                { id: 2, email: 'beta@example.com', provider: 'outlook', authType: 'oauth2', isVerified: false },
            ],
        }),
        actions: [
            {
                name: 'searchAccounts',
                title: '搜索邮箱账户',
                description: '开发验证用搜索动作。',
                risk: 'read',
                run: async (params) => {
                    await new Promise(resolve => setTimeout(resolve, 180))
                    const query = String(params.query || '')
                    return {
                        success: true,
                        summary: [
                            `开发验证：已搜索 **${query}**`,
                            '',
                            '- 命中 alpha@example.com',
                            '- 已通过页面 skill 执行',
                            '',
                            '```json',
                            JSON.stringify({ query, total: 1 }, null, 2),
                            '```',
                        ].join('\n'),
                    }
                },
            },
            {
                name: 'openAddAccountModal',
                title: '打开添加账户窗口',
                description: '开发验证用添加入口。',
                risk: 'write',
                run: () => ({ success: true, summary: '开发验证：已打开添加账户窗口。' }),
            },
        ],
    }), [])

    useAISkill(skill)

    useEffect(() => {
        if (initializedRef.current) return
        initializedRef.current = true
        setNavigationContext({ activeTab: 'accounts', openTabs: ['dashboard', 'accounts'] })
        openAssistant()
    }, [openAssistant, setNavigationContext])

    return (
        <main className="min-h-screen bg-background px-8 py-8">
            <div className="max-w-3xl">
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">AI Assistant Regression</h1>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    Development harness for the global AI runtime and task detail panel.
                </p>
            </div>
            <GlobalAIAssistant forceVisible />
        </main>
    )
}
