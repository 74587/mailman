'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Mail, Lock, Loader2, User, Shield } from 'lucide-react';
import LoginParticles from '@/components/login-particles';
import FloatingIcons from '@/components/floating-icons';
import { getAuthReturnUrl } from '@/lib/auth-return-url';

export default function ClassicLoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { login, isAuthenticated, isLoading: authLoading } = useAuth();
    const router = useRouter();

    // 如果已经登录，重定向到主页
    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.push(getAuthReturnUrl());
        }
    }, [isAuthenticated, authLoading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!username || !password) {
            return;
        }

        setIsLoading(true);
        try {
            await login(username, password);
            // 登录成功后会自动跳转到主页
        } catch (error) {
            // 错误已在 auth context 中处理
        } finally {
            setIsLoading(false);
        }
    };

    // 如果正在检查认证状态，显示加载器
    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900/20 dark:to-purple-900/20">
                <div className="relative">
                    <div className="absolute inset-0 blur-xl">
                        <div className="h-32 w-32 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob"></div>
                        <div className="h-32 w-32 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-200"></div>
                    </div>
                    <Loader2 className="h-12 w-12 animate-spin text-primary relative" />
                </div>
            </div>
        );
    }

    // 如果已经登录，不显示登录页面（会被重定向）
    if (isAuthenticated) {
        return null;
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-blue-900/20 dark:to-purple-900/20 relative overflow-hidden">
            {/* 粒子背景 */}
            <LoginParticles />

            {/* 悬浮图标 */}
            <FloatingIcons />

            {/* 背景装饰 */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 h-80 w-80 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob dark:bg-purple-600"></div>
                <div className="absolute -bottom-40 -left-40 h-80 w-80 bg-blue-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-200 dark:bg-blue-600"></div>
                <div className="absolute top-40 left-40 h-80 w-80 bg-indigo-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-400 dark:bg-indigo-600"></div>
            </div>

            <div className="w-full max-w-md px-4 relative z-10">
                {/* Logo 和标题 */}
                <div className="text-center mb-8 relative">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-2xl mb-4 animate-bounce-rotate relative">
                        <Mail className="h-10 w-10 text-white relative z-10" />
                        {/* 闪烁星星效果 */}
                        <div className="sparkle" style={{ top: '10%', left: '10%', animationDelay: '0s' }}></div>
                        <div className="sparkle" style={{ top: '20%', right: '15%', animationDelay: '0.5s' }}></div>
                        <div className="sparkle" style={{ bottom: '15%', left: '20%', animationDelay: '1s' }}></div>
                    </div>
                    <h1 className="text-4xl font-bold mb-2 relative">
                        <span className="text-rainbow">邮箱管理系统</span>
                        <div className="absolute inset-0 text-shimmer text-4xl font-bold pointer-events-none">
                            邮箱管理系统
                        </div>
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 relative">
                        <span className="inline-block animate-float">智能化的邮件管理平台</span>
                    </p>
                </div>

                {/* 登录卡片 */}
                <div className="gradient-border animate-pulse-ring">
                    <Card className="gradient-border-content backdrop-blur-md bg-white/80 dark:bg-gray-900/80 border-0">
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="username" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    用户名
                                </Label>
                                <div className="relative group">
                                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors duration-200" />
                                    <Input
                                        id="username"
                                        type="text"
                                        placeholder="请输入用户名"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="pl-11 h-12 bg-white/50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200 focus:shadow-lg focus:shadow-blue-500/20"
                                        disabled={isLoading}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    密码
                                </Label>
                                <div className="relative group">
                                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 group-focus-within:text-blue-500 transition-colors duration-200" />
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="请输入密码"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="pl-11 h-12 bg-white/50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700 focus:border-blue-500 dark:focus:border-blue-400 transition-all duration-200 focus:shadow-lg focus:shadow-blue-500/20"
                                        disabled={isLoading}
                                        required
                                    />
                                </div>
                            </div>

                            <Button
                                type="submit"
                                className="w-full h-12 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all duration-200 relative overflow-hidden group"
                                disabled={isLoading || !username || !password}
                            >
                                <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12 translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></span>
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        登录中...
                                    </>
                                ) : (
                                    <>
                                        <Shield className="mr-2 h-5 w-5" />
                                        安全登录
                                    </>
                                )}
                            </Button>
                        </form>

                        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                            <div className="flex items-center justify-center space-x-2 text-sm text-gray-600 dark:text-gray-400 animate-fade-in animation-delay-400">
                                <Shield className="h-4 w-4 animate-pulse" />
                                <p>首次登录的用户将自动注册为管理员</p>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* 底部信息 */}
                <div className="mt-8 text-center text-sm text-gray-600 dark:text-gray-400 animate-fade-in animation-delay-400">
                    <p className="relative">
                        © 2025 邮箱管理系统. All rights reserved.
                        <span className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-purple-500/20 blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500"></span>
                    </p>
                </div>
            </div>
        </div>
    );
}
