'use client'

import { useEffect, useState } from 'react'
import { ActionPipeline } from '@/components/action-debugger/action-pipeline'

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
        </main>
    )
}
