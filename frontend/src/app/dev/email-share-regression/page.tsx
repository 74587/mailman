'use client'

import EmailListPanel from '@/components/mailbox/email-list-panel'
import type { Email, EmailAccount } from '@/types'
import { useEffect, useState } from 'react'

const testEmail: Email = {
    ID: 42,
    MessageID: '<share-42@example.test>',
    AccountID: 7,
    Subject: '需要分享的测试邮件',
    From: ['sender@example.test'],
    To: ['receiver@example.test'],
    Date: '2026-07-22T08:00:00Z',
    Body: '这是一封用于验证右键分享、安全链接和一键复制的邮件。',
    MailboxName: 'INBOX',
    Size: 1024,
    direction: 'received',
    CreatedAt: '2026-07-22T08:00:00Z',
    UpdatedAt: '2026-07-22T08:00:00Z',
}

const testAccount = {
    id: 7,
    emailAddress: 'receiver@example.test',
    isVerified: true,
} as EmailAccount

export default function EmailShareRegressionPage() {
    const [selectedEmailID, setSelectedEmailID] = useState<number | null>(null)
    const [ready, setReady] = useState(false)
    useEffect(() => setReady(true), [])
    return (
        <main data-qa-ready={ready ? 'true' : 'false'} className="min-h-screen bg-gray-100 p-8 dark:bg-gray-950">
            <div className="mx-auto h-[720px] max-w-md overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <EmailListPanel
                    emails={[testEmail]}
                    selectedEmailId={selectedEmailID}
                    onSelectEmail={email => setSelectedEmailID(email.ID)}
                    onSearch={() => undefined}
                    onRefresh={async () => undefined}
                    loading={false}
                    selectedAccount={testAccount}
                    autoSyncEnabled={false}
                    onToggleAutoSync={() => undefined}
                    isRefreshing={false}
                    totalCount={1}
                    hasMore={false}
                    onLoadMore={async () => undefined}
                    loadingMore={false}
                    directionFilter="received"
                    onDirectionChange={() => undefined}
                />
            </div>
        </main>
    )
}
