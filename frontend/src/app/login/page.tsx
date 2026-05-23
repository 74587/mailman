'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { systemConfigService } from '@/services/system-config.service';
import dynamic from 'next/dynamic';

// 动态导入登录页组件，避免一次性加载所有页面
const ClassicLoginPage = dynamic(() => import('@/components/login/classic-login-page'), {
    loading: () => <LoginLoader />,
});
const ElegantLoginPage = dynamic(() => import('@/components/login/elegant-login-page'), {
    loading: () => <LoginLoader />,
});
const PlayfulLoginPage = dynamic(() => import('@/components/login/playful-login-page'), {
    loading: () => <LoginLoader />,
});

function LoginLoader() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
            <div className="text-center">
                <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto mb-3" />
                <p className="text-sm text-gray-400">加载中...</p>
            </div>
        </div>
    );
}

export default function LoginPage() {
    const [theme, setTheme] = useState<string | null>(null);

    useEffect(() => {
        // 获取登录页主题配置（公开API，无需认证）
        systemConfigService.getLoginTheme().then(t => {
            setTheme(t);
        });
    }, []);

    // 加载主题配置中
    if (!theme) {
        return <LoginLoader />;
    }

    // 根据主题渲染对应的登录页
    switch (theme) {
        case 'elegant':
            return <ElegantLoginPage />;
        case 'playful':
            return <PlayfulLoginPage />;
        case 'classic':
        default:
            return <ClassicLoginPage />;
    }
}
