'use client'

import { useAuth } from '@/context/auth-context'
import { Shield } from 'lucide-react'

interface PermissionGuardProps {
    resource: string
    action?: string  // default: 'read'
    children: React.ReactNode
    fallback?: React.ReactNode
}

export function PermissionGuard({ resource, action = 'read', children, fallback }: PermissionGuardProps) {
    const { hasPermission, isAuthenticated } = useAuth()
    
    if (!isAuthenticated) return null
    if (!hasPermission(resource, action)) {
        return fallback || (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <Shield className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                    <p className="text-sm text-gray-400 dark:text-gray-500">无权访问此功能</p>
                </div>
            </div>
        )
    }
    
    return <>{children}</>
}
