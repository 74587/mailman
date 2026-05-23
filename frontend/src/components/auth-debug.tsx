'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/context/auth-context'
import { usePathname, useRouter } from 'next/navigation'
import { logger } from '@/lib/logger'

export function AuthDebug() {
    const { user, isAuthenticated, isLoading } = useAuth()
    const pathname = usePathname()
    const router = useRouter()
    const [logs, setLogs] = useState<string[]>([])

    useEffect(() => {
        const log = (message: string) => {
            const timestamp = new Date().toISOString()
            const logEntry = `[${timestamp}] ${message}`
            logger.debug(logEntry)
            setLogs(prev => [...prev, logEntry])
        }

        log(`Current path: ${pathname}`)
        log(`Auth loading: ${isLoading}`)
        log(`Is authenticated: ${isAuthenticated}`)
        log(`User: ${user ? JSON.stringify(user) : 'null'}`)
        log(`Token exists: ${typeof window !== 'undefined' ? !!localStorage.getItem('token') : 'SSR'}`)

        // 监听路由变化
        const handleRouteChange = () => {
            log(`Route changed to: ${window.location.pathname}`)
        }

        window.addEventListener('popstate', handleRouteChange)
        return () => window.removeEventListener('popstate', handleRouteChange)
    }, [pathname, isLoading, isAuthenticated, user])

    if (process.env.NODE_ENV !== 'development') {
        return null
    }

    return (
        <div className="fixed bottom-4 right-4 bg-black/80 text-white p-4 rounded-lg max-w-md max-h-96 overflow-auto text-xs font-mono">
            <h3 className="font-bold mb-2">Auth Debug</h3>
            <div className="space-y-1">
                <div>Path: {pathname}</div>
                <div>Loading: {isLoading ? 'true' : 'false'}</div>
                <div>Authenticated: {isAuthenticated ? 'true' : 'false'}</div>
                <div>User: {user ? user.email : 'null'}</div>
            </div>
            <h4 className="font-bold mt-3 mb-1">Logs:</h4>
            <div className="space-y-1">
                {logs.slice(-10).map((log, i) => (
                    <div key={i} className="text-xs">{log}</div>
                ))}
            </div>
        </div>
    )
}
