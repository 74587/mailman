import { Metadata } from 'next'
import '@/styles/globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
    title: '邮箱管理系统',
    description: '现代化的邮箱管理平台',
    icons: {
        icon: [
            { url: '/favicon.ico', sizes: 'any' },
            { url: '/favicon.svg', type: 'image/svg+xml' },
        ],
        shortcut: '/favicon.ico',
    },
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="zh-CN" suppressHydrationWarning>
            <body className="font-sans">
                <Providers>
                    {children}
                </Providers>
            </body>
        </html>
    )
}
