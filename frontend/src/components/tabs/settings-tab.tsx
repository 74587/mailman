'use client'

import { useState } from 'react'
import { Save, Globe, Shield, Bell, Palette, Database, Key } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/theme-provider'

// 设置项组件
function SettingItem({
    icon: Icon,
    title,
    description,
    children
}: {
    icon: any
    title: string
    description: string
    children: React.ReactNode
}) {
    return (
        <div className="flex items-start space-x-4 rounded-lg bg-muted p-4">
            <div className="rounded-lg bg-background p-2 border border-border">
                <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
                <h3 className="font-medium text-foreground">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                <div className="mt-3">{children}</div>
            </div>
        </div>
    )
}

export default function SettingsTab() {
    const { theme, setTheme } = useTheme()
    const [apiUrl, setApiUrl] = useState('http://localhost:8080')
    const [syncInterval, setSyncInterval] = useState('30')
    const [emailNotifications, setEmailNotifications] = useState(true)
    const [autoSync, setAutoSync] = useState(true)
    const [saving, setSaving] = useState(false)

    const handleSave = async () => {
        setSaving(true)
        // 模拟保存操作
        await new Promise(resolve => setTimeout(resolve, 1000))
        setSaving(false)
        // TODO: 实际保存到后端或localStorage
    }

    return (
        <div className="space-y-6">
            {/* 通用设置 */}
            <div className="rounded-xl bg-card p-6 shadow-sm border border-border">
                <h2 className="mb-4 text-lg font-semibold text-foreground">
                    通用设置
                </h2>

                <div className="space-y-4">
                    {/* 主题设置 */}
                    <SettingItem
                        icon={Palette}
                        title="主题"
                        description="选择界面主题"
                    >
                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => setTheme('light')}
                                className={cn(
                                    "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                                    theme === 'light'
                                        ? "bg-primary-600 text-white"
                                        : "bg-muted text-foreground hover:bg-muted/80"
                                )}
                            >
                                ☀️ 浅色
                            </button>
                            <button
                                onClick={() => setTheme('dark')}
                                className={cn(
                                    "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                                    theme === 'dark'
                                        ? "bg-primary-600 text-white"
                                        : "bg-muted text-foreground hover:bg-muted/80"
                                )}
                            >
                                🌙 深色
                            </button>
                            {/* 临时隐藏樱花粉主题
                            <button
                                onClick={() => setTheme('sakura')}
                                className={cn(
                                    "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                                    theme === 'sakura'
                                        ? "bg-pink-500 text-white"
                                        : "bg-muted text-foreground hover:bg-muted/80"
                                )}
                            >
                                🌸 樱花粉
                            </button>
                            */}
                            <button
                                onClick={() => setTheme('system')}
                                className={cn(
                                    "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                                    theme === 'system'
                                        ? "bg-primary-600 text-white"
                                        : "bg-muted text-foreground hover:bg-muted/80"
                                )}
                            >
                                💻 跟随系统
                            </button>
                        </div>
                    </SettingItem>

                    {/* API设置 */}
                    <SettingItem
                        icon={Globe}
                        title="API地址"
                        description="后端服务器地址"
                    >
                        <input
                            type="text"
                            value={apiUrl}
                            onChange={(e) => setApiUrl(e.target.value)}
                            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                    </SettingItem>

                    {/* 同步设置 */}
                    <SettingItem
                        icon={Database}
                        title="自动同步"
                        description="定时自动同步邮件"
                    >
                        <div className="flex items-center space-x-4">
                            <label className="flex items-center space-x-2">
                                <input
                                    type="checkbox"
                                    checked={autoSync}
                                    onChange={(e) => setAutoSync(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                />
                                <span className="text-sm text-foreground">
                                    启用自动同步
                                </span>
                            </label>
                            {autoSync && (
                                <div className="flex items-center space-x-2">
                                    <span className="text-sm text-muted-foreground">
                                        间隔:
                                    </span>
                                    <input
                                        type="number"
                                        value={syncInterval}
                                        onChange={(e) => setSyncInterval(e.target.value)}
                                        className="w-20 rounded-lg border border-input bg-background px-3 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                    />
                                    <span className="text-sm text-muted-foreground">
                                        分钟
                                    </span>
                                </div>
                            )}
                        </div>
                    </SettingItem>
                </div>
            </div>

            {/* 通知设置 */}
            <div className="rounded-xl bg-card p-6 shadow-sm border border-border">
                <h2 className="mb-4 text-lg font-semibold text-foreground">
                    通知设置
                </h2>

                <SettingItem
                    icon={Bell}
                    title="邮件通知"
                    description="收到新邮件时通知"
                >
                    <label className="flex items-center space-x-2">
                        <input
                            type="checkbox"
                            checked={emailNotifications}
                            onChange={(e) => setEmailNotifications(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="text-sm text-foreground">
                            启用桌面通知
                        </span>
                    </label>
                </SettingItem>
            </div>

            {/* 安全设置 */}
            <div className="rounded-xl bg-card p-6 shadow-sm border border-border">
                <h2 className="mb-4 text-lg font-semibold text-foreground">
                    安全设置
                </h2>

                <div className="space-y-4">
                    <SettingItem
                        icon={Shield}
                        title="两步验证"
                        description="增强账户安全性"
                    >
                        <button className="rounded-lg bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80">
                            配置两步验证
                        </button>
                    </SettingItem>

                    <SettingItem
                        icon={Key}
                        title="API密钥"
                        description="管理API访问密钥"
                    >
                        <button className="rounded-lg bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80">
                            管理密钥
                        </button>
                    </SettingItem>
                </div>
            </div>

            {/* 保存按钮 */}
            <div className="flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={cn(
                        "flex items-center space-x-2 rounded-lg px-6 py-2 font-medium transition-colors",
                        saving
                            ? "bg-gray-100 text-gray-400 cursor-not-allowed dark:bg-gray-700"
                            : "bg-primary-600 text-white hover:bg-primary-700"
                    )}
                >
                    <Save className="h-4 w-4" />
                    <span>{saving ? '保存中...' : '保存设置'}</span>
                </button>
            </div>
        </div>
    )
}