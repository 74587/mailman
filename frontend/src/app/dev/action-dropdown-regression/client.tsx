'use client'

import { useEffect, useState } from 'react'
import { Wrench, RefreshCw } from 'lucide-react'
import { ActionPipeline } from '@/components/action-debugger/action-pipeline'
import { AdaptiveActions } from '@/components/ui/adaptive-actions'
import SyncConfigModal from '@/components/modals/sync-config-modal'

interface RegressionAction {
    id: string
    pluginId: string
    pluginName: string
    config: Record<string, unknown>
    enabled: boolean
    executionOrder: number
}

const availablePlugins = Array.from({ length: 24 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0')

    return {
        id: `regression_action_${number}`,
        name: `回归动作 ${number}`,
        description: `用于验证动作下拉菜单滚动与点击命中的测试动作 ${number}`,
    }
})

export function ActionDropdownRegressionClient() {
    const [isReady, setIsReady] = useState(false)
    const [actions, setActions] = useState<RegressionAction[]>([
        {
            id: 'existing-action',
            pluginId: 'existing_action',
            pluginName: '已有动作',
            config: {},
            enabled: true,
            executionOrder: 1,
        },
    ])
    const [syncConfigOpen, setSyncConfigOpen] = useState(false)
    const [interactionCount, setInteractionCount] = useState(0)

    const handleAddAction = (pluginId: string) => {
        const plugin = availablePlugins.find((item) => item.id === pluginId)
        const nextAction: RegressionAction = {
            id: `${pluginId}-${Date.now()}`,
            pluginId,
            pluginName: plugin?.name || pluginId,
            config: {},
            enabled: true,
            executionOrder: actions.length + 1,
        }

        setActions((currentActions) => [
            ...currentActions,
            {
                ...nextAction,
                executionOrder: currentActions.length + 1,
            },
        ])
    }

    useEffect(() => {
        setIsReady(true)
    }, [])

    return (
        <main
            className="min-h-[900px] bg-gray-50 px-8 pb-16 pt-[460px]"
            data-ready={isReady}
            data-testid="action-dropdown-regression"
        >
            <ActionPipeline
                actions={actions}
                selectedActionId={actions[0]?.id}
                availablePlugins={availablePlugins}
                onActionsChange={setActions}
                onActionSelect={() => undefined}
                onAddAction={handleAddAction}
                onExecute={() => undefined}
                isExecuting={false}
            />

            <section className="mt-12 rounded-lg border bg-white p-4">
                <div className="w-16" data-testid="adaptive-actions-regression">
                    <AdaptiveActions
                        maxVisible={1}
                        actions={[
                            {
                                id: 'refresh',
                                icon: RefreshCw,
                                label: '刷新',
                                onClick: () => undefined,
                            },
                            {
                                id: 'repair',
                                icon: Wrench,
                                label: '打开同步配置',
                                onClick: () => setSyncConfigOpen(true),
                            },
                        ]}
                    />
                </div>
                <button
                    type="button"
                    data-testid="page-interaction-target"
                    onClick={() => setInteractionCount((count) => count + 1)}
                >
                    页面交互计数：{interactionCount}
                </button>
            </section>

            <SyncConfigModal
                isOpen={syncConfigOpen}
                mode="create"
                lockAccountSelection
                config={{
                    account_id: 1,
                    enable_auto_sync: true,
                    sync_interval: 300,
                    sync_folders: ['INBOX'],
                    account: {
                        id: 1,
                        emailAddress: 'regression@outlook.com',
                        authType: 'oauth2',
                        mailProviderId: 1,
                        mailProvider: {
                            id: 1,
                            name: 'Outlook',
                            type: 'outlook',
                            imapServer: 'outlook.office365.com',
                            imapPort: 993,
                        },
                    },
                }}
                onClose={() => setSyncConfigOpen(false)}
                onSuccess={() => setSyncConfigOpen(false)}
            />
        </main>
    )
}
