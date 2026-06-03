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
            {
                name: 'viewAccountEmails',
                title: '查看账户邮件',
                description: '开发验证用账户邮件入口。',
                risk: 'navigation',
                run: (params) => {
                    const email = String(params.email || params.emailAddress || params.query || '')
                    return {
                        success: true,
                        summary: `开发验证：已切换到 ${email || '指定账户'} 的邮件列表。`,
                        data: {
                            email,
                            nextAction: {
                                skillId: 'classic-mailbox',
                                actionName: 'openAccountInbox',
                                params: { email },
                            },
                        },
                    }
                },
            },
        ],
    }), [])

    const mailboxSkill = useMemo<AISkill>(() => ({
        id: 'classic-mailbox',
        title: '经典邮件管理器',
        description: 'AI regression harness for mailbox actions.',
        pageTabs: ['classic-mailbox'],
        getContext: () => ({
            selectedAccount: { id: 1, email: 'alpha@example.com', provider: 'gmail', isVerified: true },
            selectedEmailId: 101,
            hasSelectedEmail: true,
            activePanel: 'preview',
            loadedEmailsCount: 2,
            totalCount: 2,
            selectedEmail: {
                id: 101,
                subject: 'Fivetran account idle warning',
                from: 'Fivetran <hello@fivetran.com>',
                to: 'alpha@example.com',
                date: '2026-06-04T06:10:29Z',
                bodyPreview: 'Your Fivetran account has idle resources and may need attention.',
                hasAttachments: false,
                attachmentCount: 0,
            },
            sampleAccounts: [
                { id: 1, email: 'alpha@example.com', provider: 'gmail', isVerified: true },
                { id: 2, email: 'beta@example.com', provider: 'outlook', isVerified: false },
            ],
        }),
        actions: [
            {
                name: 'openAccountInbox',
                title: '打开账户收件箱',
                description: '开发验证用收件箱加载动作。',
                risk: 'navigation',
                run: async (params) => {
                    await new Promise(resolve => setTimeout(resolve, 120))
                    const email = String(params.email || params.emailAddress || params.query || '')
                    return {
                        success: true,
                        summary: `开发验证：已打开 ${email || '指定账户'} 的收件箱，当前加载 2 封。`,
                        data: { email, loadedEmailsCount: 2 },
                    }
                },
            },
            {
                name: 'getSelectedEmailDetails',
                title: '读取当前选中邮件',
                description: '开发验证用当前邮件详情动作。',
                risk: 'read',
                run: () => ({
                    success: true,
                    summary: '当前选中邮件是「Fivetran account idle warning」，发件人 Fivetran <hello@fivetran.com>。内容摘要：Your Fivetran account has idle resources and may need attention.',
                    details: 'Your Fivetran account has idle resources and may need attention.',
                    data: {
                        selectedEmail: {
                            id: 101,
                            subject: 'Fivetran account idle warning',
                            from: 'Fivetran <hello@fivetran.com>',
                            bodyPreview: 'Your Fivetran account has idle resources and may need attention.',
                        },
                    },
                }),
            },
        ],
    }), [])

    useAISkill(skill)
    useAISkill(mailboxSkill)

    useEffect(() => {
        if (initializedRef.current) return
        initializedRef.current = true
        setNavigationContext({ activeTab: 'classic-mailbox', openTabs: ['dashboard', 'accounts', 'classic-mailbox'] })
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
