'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { Loader2 } from 'lucide-react';

interface AuthGuardProps {
    children: React.ReactNode;
    requireAuth?: boolean;
}

export function AuthGuard({ children, requireAuth = true }: AuthGuardProps) {
    const { isAuthenticated, isLoading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (!isLoading) {
            if (requireAuth && !isAuthenticated) {
                // 需要认证但未登录，重定向到登录页
                router.push('/login');
            } else if (!requireAuth && isAuthenticated && pathname === '/login') {
                // 已登录但在登录页，重定向到主页
                router.push('/main');
            }
        }
    }, [isAuthenticated, isLoading, requireAuth, router, pathname]);

    // 加载中显示加载器
    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    // 需要认证但未登录，不渲染内容（会被重定向）
    if (requireAuth && !isAuthenticated) {
        return null;
    }

    // 不需要认证但已登录且在登录页，不渲染内容（会被重定向）
    if (!requireAuth && isAuthenticated && pathname === '/login') {
        return null;
    }

    return <>{children}</>;
}
