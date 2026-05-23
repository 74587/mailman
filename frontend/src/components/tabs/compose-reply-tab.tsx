'use client'
import { logger } from '@/lib/logger';

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import { Email } from '@/types'
import { registerTabCallback, unregisterTabCallback } from '@/lib/tab-utils'

// 动态导入 ComposeEmailTab
const ComposeEmailTab = dynamic(() => import('@/components/tabs/compose-email-tab'), {
    ssr: false,
    loading: () => (
        <div className="flex h-full items-center justify-center">
            <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>加载撰写邮件...</span>
            </div>
        </div>
    ),
})

// 解析 Tab ID 获取模式和邮件 ID
function parseTabId(tabId: string): { mode: 'reply' | 'reply-all' | 'forward'; emailId: number } | null {
    if (tabId.startsWith('compose-reply-all-')) {
        const emailId = parseInt(tabId.replace('compose-reply-all-', ''))
        return { mode: 'reply-all', emailId }
    }
    if (tabId.startsWith('compose-reply-')) {
        const emailId = parseInt(tabId.replace('compose-reply-', ''))
        return { mode: 'reply', emailId }
    }
    if (tabId.startsWith('compose-forward-')) {
        const emailId = parseInt(tabId.replace('compose-forward-', ''))
        return { mode: 'forward', emailId }
    }
    return null
}

interface ComposeReplyTabProps {
    tabId: string
}

export default function ComposeReplyTab({ tabId }: ComposeReplyTabProps) {
    const [isReady, setIsReady] = useState(false)
    const [composeData, setComposeData] = useState<{
        mode: 'reply' | 'reply-all' | 'forward'
        originalEmail: Email
        accountId?: number
    } | null>(null)

    // 处理从 switchTab 事件传递的数据
    const handleTabData = useCallback((data: any) => {
        logger.debug('[ComposeReplyTab] 收到数据:', data)
        if (data?.mode && data?.originalEmail) {
            setComposeData({
                mode: data.mode,
                originalEmail: data.originalEmail,
                accountId: data.accountId
            })
            setIsReady(true)
        }
    }, [])

    // 注册 Tab 回调
    useEffect(() => {
        logger.debug('[ComposeReplyTab] 注册回调:', tabId)
        registerTabCallback(tabId, 'onReady', handleTabData)

        const event = new CustomEvent('tabCallbackRegistered', {
            detail: { tabId, callbackName: 'onReady' }
        })
        window.dispatchEvent(event)

        return () => {
            logger.debug('[ComposeReplyTab] 注销回调:', tabId)
            unregisterTabCallback(tabId, 'onReady')
        }
    }, [tabId, handleTabData])

    // 未收到数据时显示加载状态
    if (!isReady || !composeData) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>准备邮件数据...</span>
                </div>
            </div>
        )
    }

    // 渲染 ComposeEmailTab 并传递初始数据
    return (
        <ComposeEmailTab
            initialMode={composeData.mode}
            initialEmail={composeData.originalEmail}
            initialAccountId={composeData.accountId}
        />
    )
}
