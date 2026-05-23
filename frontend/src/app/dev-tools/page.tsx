'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DevToolsPage() {
    const [token, setToken] = useState('');
    const router = useRouter();

    const handleSetToken = () => {
        if (token) {
            // 设置 token 到 localStorage
            localStorage.setItem('auth_token', token);

            alert('Token 已设置！');

            // 跳转到主页面
            router.push('/main');
        }
    };

    const devTools = [
        {
            title: '表达式调试器',
            description: '构建和测试复杂的条件表达式',
            path: '/dev/expression-debugger',
            icon: '🔍'
        },
        {
            title: '动作调试器',
            description: '配置和测试邮件处理动作',
            path: '/dev/action-debugger',
            icon: '⚡'
        },
        {
            title: '过滤动作触发器',
            description: '完整的触发器测试：过滤器 + 动作',
            path: '/dev/filter-action-trigger',
            icon: '🚀'
        }
    ];

    return (
        <div className="min-h-screen bg-gray-100 p-4">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold mb-8 text-center">开发工具中心</h1>

                {/* Token 设置区域 */}
                <div className="bg-white rounded-lg shadow-md p-6 mb-8">
                    <h2 className="text-xl font-bold mb-4">认证设置</h2>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-1">
                                认证 Token
                            </label>
                            <textarea
                                id="token"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                rows={3}
                                placeholder="粘贴您的认证 token..."
                            />
                        </div>

                        <button
                            onClick={handleSetToken}
                            className="bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 transition-colors"
                        >
                            设置 Token
                        </button>

                        <div className="text-sm text-gray-600">
                            <p>Token 将被保存到 localStorage 用于 API 调用认证</p>
                        </div>
                    </div>
                </div>

                {/* 开发工具列表 */}
                <div className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-bold mb-4">调试工具</h2>
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {devTools.map((tool, index) => (
                            <div
                                key={index}
                                onClick={() => router.push(tool.path)}
                                className="p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:shadow-md cursor-pointer transition-all"
                            >
                                <div className="text-2xl mb-2">{tool.icon}</div>
                                <h3 className="font-semibold text-lg mb-2">{tool.title}</h3>
                                <p className="text-sm text-gray-600">{tool.description}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 快捷操作 */}
                <div className="bg-white rounded-lg shadow-md p-6 mt-8">
                    <h2 className="text-xl font-bold mb-4">快捷操作</h2>
                    <div className="flex gap-4 flex-wrap">
                        <button
                            onClick={() => router.push('/main')}
                            className="bg-green-500 text-white py-2 px-4 rounded-md hover:bg-green-600 transition-colors"
                        >
                            📧 进入邮件管理
                        </button>
                        <button
                            onClick={() => router.push('/triggers')}
                            className="bg-purple-500 text-white py-2 px-4 rounded-md hover:bg-purple-600 transition-colors"
                        >
                            ⚙️ 触发器管理
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}