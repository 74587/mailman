'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
    BookOpen, Copy, Check, ChevronDown, ChevronRight,
    ArrowRight, Globe, Shield, Key, Mail, Server,
    CheckCircle2, Clock, XCircle, AlertCircle,
    ExternalLink, Zap, RefreshCw, Settings,
    FileText, Code2, Database, Search,
    Container, HardDrive, Wrench, Network, Terminal, Cpu, Lock, CloudCog,
    Rocket, Box, Layers, Monitor, type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// ==================== 子组件 ====================

// HTTP 方法标签
function MethodBadge({ method }: { method: string }) {
    const colors: Record<string, string> = {
        GET: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
        POST: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200 dark:border-blue-800',
        PUT: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 border-amber-200 dark:border-amber-800',
        DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-red-200 dark:border-red-800',
    }
    return (
        <span className={cn(
            'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold tracking-wide border',
            colors[method] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
        )}>
            {method}
        </span>
    )
}

// 可复制的代码块
function CodeBlock({ code, language = 'bash', title }: { code: string; language?: string; title?: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            toast.success('已复制到剪贴板')
            setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error('复制失败')
        }
    }

    return (
        <div className="group relative rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden my-3">
            {title && (
                <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{title}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">{language}</span>
                </div>
            )}
            <div className="relative">
                <pre className="p-4 overflow-x-auto text-sm leading-relaxed bg-gray-900 dark:bg-gray-950 text-gray-100 font-mono">
                    <code>{code}</code>
                </pre>
                <button
                    onClick={handleCopy}
                    className={cn(
                        'absolute top-2 right-2 p-1.5 rounded-lg transition-all duration-200',
                        'opacity-0 group-hover:opacity-100',
                        'bg-gray-700/80 hover:bg-gray-600 text-gray-300 hover:text-white'
                    )}
                    title="复制代码"
                >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
            </div>
        </div>
    )
}

// 可折叠的代码块
function CollapsibleCode({ code, language = 'bash', title, defaultOpen = false }: {
    code: string; language?: string; title: string; defaultOpen?: boolean
}) {
    const [open, setOpen] = useState(defaultOpen)

    return (
        <div className="my-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center justify-between w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-800/80 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
            >
                <div className="flex items-center gap-2">
                    <Code2 className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</span>
                </div>
                <ChevronDown className={cn(
                    'w-4 h-4 text-gray-400 transition-transform duration-200',
                    open && 'rotate-180'
                )} />
            </button>
            <div className={cn(
                'overflow-hidden transition-all duration-300',
                open ? 'max-h-[600px]' : 'max-h-0'
            )}>
                <CodeBlock code={code} language={language} />
            </div>
        </div>
    )
}

// API 端点行
function ApiEndpoint({ method, path, description }: { method: string; path: string; description: string }) {
    return (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
            <MethodBadge method={method} />
            <code className="text-sm font-mono text-gray-800 dark:text-gray-200 flex-shrink-0">{path}</code>
            <span className="text-sm text-gray-500 dark:text-gray-400 truncate">{description}</span>
        </div>
    )
}

// 提示框
function Callout({ type, children }: { type: 'info' | 'tip' | 'warning' | 'important'; children: React.ReactNode }) {
    const styles = {
        info: {
            bg: 'bg-blue-50 dark:bg-blue-950/30',
            border: 'border-blue-200 dark:border-blue-800/60',
            icon: <AlertCircle className="w-4 h-4 text-blue-500" />,
            title: '说明',
            titleColor: 'text-blue-700 dark:text-blue-400',
        },
        tip: {
            bg: 'bg-emerald-50 dark:bg-emerald-950/30',
            border: 'border-emerald-200 dark:border-emerald-800/60',
            icon: <Zap className="w-4 h-4 text-emerald-500" />,
            title: '提示',
            titleColor: 'text-emerald-700 dark:text-emerald-400',
        },
        warning: {
            bg: 'bg-amber-50 dark:bg-amber-950/30',
            border: 'border-amber-200 dark:border-amber-800/60',
            icon: <AlertCircle className="w-4 h-4 text-amber-500" />,
            title: '注意',
            titleColor: 'text-amber-700 dark:text-amber-400',
        },
        important: {
            bg: 'bg-purple-50 dark:bg-purple-950/30',
            border: 'border-purple-200 dark:border-purple-800/60',
            icon: <Shield className="w-4 h-4 text-purple-500" />,
            title: '重要',
            titleColor: 'text-purple-700 dark:text-purple-400',
        },
    }

    const s = styles[type]

    return (
        <div className={cn('rounded-xl border p-4 my-4', s.bg, s.border)}>
            <div className="flex items-center gap-2 mb-1.5">
                {s.icon}
                <span className={cn('text-sm font-semibold', s.titleColor)}>{s.title}</span>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed pl-6">
                {children}
            </div>
        </div>
    )
}

// 响应字段表格
function FieldTable({ fields }: { fields: { name: string; type: string; required?: boolean; desc: string }[] }) {
    return (
        <div className="my-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/80">
                        <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">字段</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">类型</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">必填</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">说明</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {fields.map((f) => (
                        <tr key={f.name} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                            <td className="px-4 py-2.5">
                                <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200">{f.name}</code>
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 font-mono text-xs">{f.type}</td>
                            <td className="px-4 py-2.5">
                                {f.required ? (
                                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">✓ 是</span>
                                ) : (
                                    <span className="text-xs text-gray-400">可选</span>
                                )}
                            </td>
                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{f.desc}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

// 步骤指示器
function StepIndicator({ step, title, active }: { step: number; title: string; active?: boolean }) {
    return (
        <div className="flex items-center gap-3 mb-4">
            <div className={cn(
                'flex items-center justify-center w-9 h-9 rounded-xl text-sm font-bold shadow-sm transition-all',
                active
                    ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-blue-500/25'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
            )}>
                {step}
            </div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
        </div>
    )
}

// OAuth 流程图 (纯 HTML/CSS 动画)
function OAuthFlowDiagram() {
    const [animStep, setAnimStep] = useState(-1)

    useEffect(() => {
        const timer = setInterval(() => {
            setAnimStep(prev => (prev >= 8 ? -1 : prev + 1))
        }, 1500)
        return () => clearInterval(timer)
    }, [])

    const actors = [
        { id: 'client', label: 'API 调用方', icon: Code2, color: 'blue' },
        { id: 'backend', label: 'Mailman 后端', icon: Server, color: 'indigo' },
        { id: 'google', label: 'Google OAuth2', icon: Globe, color: 'emerald' },
        { id: 'browser', label: '用户浏览器', icon: Search, color: 'amber' },
    ]

    const steps = [
        { from: 0, to: 1, label: '1. 确保 OAuth2 全局配置存在', direction: 'right' as const },
        { from: 0, to: 1, label: '2. 启动 OAuth2 会话 (获取 auth_url)', direction: 'right' as const },
        { from: 0, to: 3, label: '3. 将 auth_url 给用户打开', direction: 'right' as const },
        { from: 3, to: 2, label: '4. 用户登录并授权', direction: 'right' as const },
        { from: 2, to: 1, label: '5. 回调 (携带 code)', direction: 'left' as const },
        { from: 1, to: 2, label: '6. 用 code 换取 tokens', direction: 'right' as const },
        { from: 1, to: 1, label: '7. 获取用户邮箱信息', direction: 'self' as const },
        { from: 0, to: 1, label: '8. 轮询会话状态 (直到 success)', direction: 'right' as const },
        { from: 0, to: 1, label: '9. 创建邮箱账户', direction: 'right' as const },
    ]

    const actorColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
        blue: {
            bg: 'bg-blue-50 dark:bg-blue-900/30',
            border: 'border-blue-200 dark:border-blue-700',
            text: 'text-blue-700 dark:text-blue-400',
            glow: 'shadow-blue-500/20',
        },
        indigo: {
            bg: 'bg-indigo-50 dark:bg-indigo-900/30',
            border: 'border-indigo-200 dark:border-indigo-700',
            text: 'text-indigo-700 dark:text-indigo-400',
            glow: 'shadow-indigo-500/20',
        },
        emerald: {
            bg: 'bg-emerald-50 dark:bg-emerald-900/30',
            border: 'border-emerald-200 dark:border-emerald-700',
            text: 'text-emerald-700 dark:text-emerald-400',
            glow: 'shadow-emerald-500/20',
        },
        amber: {
            bg: 'bg-amber-50 dark:bg-amber-900/30',
            border: 'border-amber-200 dark:border-amber-700',
            text: 'text-amber-700 dark:text-amber-400',
            glow: 'shadow-amber-500/20',
        },
    }

    return (
        <div className="my-6 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-950">
            <div className="flex items-center gap-2 mb-5">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600">
                    <Zap className="w-4 h-4 text-white" />
                </div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-white">OAuth2 授权流程</h4>
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">动态演示</span>
            </div>

            {/* 角色栏 */}
            <div className="grid grid-cols-4 gap-3 mb-6">
                {actors.map((actor, idx) => {
                    const c = actorColors[actor.color]
                    const isActive = animStep >= 0 && (steps[animStep]?.from === idx || steps[animStep]?.to === idx)
                    return (
                        <div
                            key={actor.id}
                            className={cn(
                                'flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all duration-500',
                                c.bg, c.border,
                                isActive && `shadow-lg ${c.glow} scale-105`
                            )}
                        >
                            <actor.icon className={cn('w-5 h-5 transition-all', c.text, isActive && 'animate-pulse')} />
                            <span className={cn('text-xs font-semibold text-center', c.text)}>{actor.label}</span>
                        </div>
                    )
                })}
            </div>

            {/* 步骤列表 */}
            <div className="space-y-2">
                {steps.map((step, idx) => {
                    const isActive = animStep === idx
                    const isPast = animStep > idx
                    return (
                        <div
                            key={idx}
                            className={cn(
                                'flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all duration-500',
                                isActive
                                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700 shadow-md shadow-blue-500/10 scale-[1.02]'
                                    : isPast
                                        ? 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700/50 opacity-60'
                                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800 opacity-40'
                            )}
                        >
                            <div className={cn(
                                'flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold transition-all',
                                isActive
                                    ? 'bg-blue-500 text-white'
                                    : isPast
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                            )}>
                                {isPast ? <Check className="w-3 h-3" /> : idx + 1}
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                                <span className="font-medium text-gray-500 dark:text-gray-400">{actors[step.from].label}</span>
                                <ArrowRight className={cn('w-3 h-3', isActive ? 'text-blue-500' : 'text-gray-300 dark:text-gray-600')} />
                                <span className="font-medium text-gray-500 dark:text-gray-400">{actors[step.to].label}</span>
                            </div>
                            <span className={cn(
                                'text-xs flex-1',
                                isActive ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-gray-500 dark:text-gray-400'
                            )}>
                                {step.label}
                            </span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

// 状态徽章
function StatusBadge({ status }: { status: 'pending' | 'success' | 'failed' | 'expired' | 'cancelled' }) {
    const styles = {
        pending: { icon: <Clock className="w-3 h-3" />, text: 'pending', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
        success: { icon: <CheckCircle2 className="w-3 h-3" />, text: 'success', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' },
        failed: { icon: <XCircle className="w-3 h-3" />, text: 'failed', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
        expired: { icon: <Clock className="w-3 h-3" />, text: 'expired', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
        cancelled: { icon: <XCircle className="w-3 h-3" />, text: 'cancelled', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
    }

    const s = styles[status]
    return (
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', s.color)}>
            {s.icon} {s.text}
        </span>
    )
}

// 状态表格
function StatusTable() {
    const statuses: Array<{ status: 'pending' | 'success' | 'failed' | 'expired' | 'cancelled'; desc: string }> = [
        { status: 'pending', desc: '等待用户授权中' },
        { status: 'success', desc: '✅ 授权成功，可以创建账户' },
        { status: 'failed', desc: '❌ 授权失败' },
        { status: 'expired', desc: '⏰ 会话已过期（10分钟）' },
        { status: 'cancelled', desc: '🚫 已被取消' },
    ]

    return (
        <div className="my-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/80">
                        <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">状态</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">说明</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {statuses.map((s) => (
                        <tr key={s.status} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                            <td className="px-4 py-2.5"><StatusBadge status={s.status} /></td>
                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{s.desc}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

// ==================== 架构图组件 ====================

function ArchitectureDiagram({ type }: { type: 'all-in-one' | 'compose' }) {
    if (type === 'all-in-one') {
        return (
            <div className="my-4 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-950">
                <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
                        <Box className="w-3.5 h-3.5 text-white" />
                    </div>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">All-in-One 架构</h4>
                </div>
                <div className="flex items-center justify-center">
                    <div className="relative w-full max-w-lg">
                        {/* 外层容器 */}
                        <div className="border-2 border-dashed border-blue-300 dark:border-blue-700 rounded-2xl p-4">
                            <div className="text-center text-[10px] font-semibold text-blue-500 dark:text-blue-400 mb-3">Docker 容器 (All-in-One)</div>
                            {/* Go Binary */}
                            <div className="flex justify-center mb-3">
                                <div className="px-4 py-3 rounded-lg bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800 text-center w-full max-w-xs">
                                    <Server className="w-5 h-5 text-blue-600 dark:text-blue-400 mx-auto mb-1.5" />
                                    <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">mailman (Go Binary)</div>
                                    <div className="text-[10px] text-blue-500/70 mt-1">:8080</div>
                                </div>
                            </div>
                            {/* 路由说明 */}
                            <div className="flex justify-center gap-6 mb-3">
                                <div className="px-2.5 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">
                                    /api/* → API 路由
                                </div>
                                <div className="px-2.5 py-1 rounded-md bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-[10px] text-purple-600 dark:text-purple-400 font-medium">
                                    {'/* → 静态前端文件'}
                                </div>
                            </div>
                            {/* Volume */}
                            <div className="mt-3 flex justify-center">
                                <div className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-[10px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                    <HardDrive className="w-3 h-3" /> Volume: /app/data (SQLite)
                                </div>
                            </div>
                        </div>
                        {/* 用户 */}
                        <div className="absolute -left-4 top-1/2 -translate-y-1/2 -translate-x-full">
                            <div className="flex items-center gap-2">
                                <div className="px-2 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-400 font-medium">用户</div>
                                <ArrowRight className="w-3 h-3 text-gray-400" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="my-4 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-950">
            <div className="flex items-center gap-2 mb-4">
                <div className="p-1.5 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
                    <Layers className="w-3.5 h-3.5 text-white" />
                </div>
                <h4 className="text-sm font-bold text-gray-900 dark:text-white">Docker Compose 架构</h4>
            </div>
            <div className="flex items-center justify-center">
                <div className="relative w-full max-w-xl">
                    <div className="border-2 border-dashed border-indigo-300 dark:border-indigo-700 rounded-2xl p-4">
                        <div className="text-center text-[10px] font-semibold text-indigo-500 dark:text-indigo-400 mb-3">Docker Network</div>
                        <div className="flex items-center justify-center gap-3">
                            <div className="px-3 py-2.5 rounded-lg bg-teal-100 dark:bg-teal-900/40 border border-teal-200 dark:border-teal-800 text-center">
                                <Database className="w-4 h-4 text-teal-600 dark:text-teal-400 mx-auto mb-1" />
                                <div className="text-xs font-semibold text-teal-700 dark:text-teal-400">PostgreSQL</div>
                                <div className="text-[10px] text-teal-500/70">(16) :5432</div>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                            <div className="px-3 py-2.5 rounded-lg bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800 text-center">
                                <Server className="w-4 h-4 text-blue-600 dark:text-blue-400 mx-auto mb-1" />
                                <div className="text-xs font-semibold text-blue-700 dark:text-blue-400">Mailman</div>
                                <div className="text-[10px] text-blue-500/70">(All-in-One) :8080</div>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                            <div className="px-3 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700 text-center">
                                <Monitor className="w-4 h-4 text-gray-600 dark:text-gray-400 mx-auto mb-1" />
                                <div className="text-xs font-semibold text-gray-700 dark:text-gray-400">用户</div>
                                <div className="text-[10px] text-gray-500/70">浏览器访问</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

// 部署方式选择卡片
function DeployMethodCard({ title, audience, complexity, time, recommended, icon: Icon, onClick }: {
    title: string; audience: string; complexity: number; time: string; recommended?: boolean; icon: any; onClick?: () => void
}) {
    return (
        <div
            onClick={onClick}
            className={cn(
                'relative p-4 rounded-xl border transition-all hover:shadow-md cursor-pointer group',
                recommended
                    ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10 hover:border-blue-400 dark:hover:border-blue-600'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-blue-300 dark:hover:border-blue-700'
            )}
        >
            {recommended && (
                <span className="absolute -top-2 right-3 px-2 py-0.5 bg-blue-500 text-white text-[10px] font-bold rounded-full">推荐</span>
            )}
            <div className="flex items-center gap-2 mb-2">
                <Icon className={cn('w-4 h-4 transition-colors', recommended ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 group-hover:text-blue-500')} />
                <span className="text-sm font-semibold text-gray-900 dark:text-white">{title}</span>
                <ArrowRight className="w-3 h-3 text-gray-300 dark:text-gray-600 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{audience}</p>
            <div className="flex items-center gap-3 text-[11px] text-gray-400">
                <span>复杂度 {'⭐'.repeat(complexity)}</span>
                <span>·</span>
                <span>{time}</span>
            </div>
        </div>
    )
}

// ==================== 目录定义 ====================

const TOC_OAUTH = [
    { id: 'overview', label: '概述', icon: BookOpen },
    { id: 'prerequisites', label: '前置条件', icon: Settings },
    { id: 'step-1', label: '步骤 1：配置 OAuth2', icon: Key },
    { id: 'step-2', label: '步骤 2：启动授权会话', icon: Zap },
    { id: 'step-3', label: '步骤 3：用户授权', icon: Globe },
    { id: 'step-4', label: '步骤 4：轮询状态', icon: RefreshCw },
    { id: 'step-5', label: '步骤 5：创建账户', icon: Mail },
    { id: 'step-6', label: '步骤 6：验证连通性', icon: CheckCircle2 },
    { id: 'api-reference', label: 'API 接口参考', icon: Database },
    { id: 'alternative', label: '替代方案', icon: ArrowRight },
    { id: 'refresh-token', label: '刷新 Token', icon: RefreshCw },
    { id: 'faq', label: '常见问题', icon: AlertCircle },
]

const TOC_MAIL_API = [
    { id: 'mail-api-overview', label: '邮件 API 总览', icon: Mail },
    { id: 'mail-api-auth', label: '登录与 Token', icon: Key },
    { id: 'mail-api-accounts', label: '获取邮箱账户', icon: Database },
    { id: 'mail-api-read', label: '同步并读取邮件', icon: Search },
    { id: 'mail-api-pickup', label: '取件轮询逻辑', icon: Zap },
    { id: 'mail-api-code', label: '完整代码示例', icon: Code2 },
]

const TOC_DEPLOY = [
    { id: 'deploy-overview', label: '部署概述', icon: Rocket },
    { id: 'deploy-makefile', label: 'Makefile 命令', icon: Terminal },
    { id: 'deploy-docker', label: 'Docker 一键部署', icon: Container },
    { id: 'deploy-compose', label: 'Docker Compose', icon: Layers },
    { id: 'deploy-build', label: '本地构建镜像', icon: Box },
    { id: 'deploy-k3s', label: 'K3s 轻量集群', icon: CloudCog },
    { id: 'deploy-helm', label: 'Helm Chart', icon: Network },
    { id: 'deploy-source', label: '源码开发环境', icon: Terminal },
    { id: 'deploy-env', label: '环境变量说明', icon: Settings },
    { id: 'deploy-troubleshoot', label: '故障排查', icon: Wrench },
]

type GuideId = 'oauth' | 'mail-api' | 'deploy'

type GuideDoc = {
    id: GuideId
    title: string
    eyebrow: string
    description: string
    sections: typeof TOC_OAUTH
    primarySection: string
    icon: LucideIcon
    accent: string
    surface: string
    glow: string
    stats: string[]
}

const GUIDE_DOCS: GuideDoc[] = [
    {
        id: 'oauth',
        title: 'OAuth 接入',
        eyebrow: 'Gmail Authorization',
        description: '从 OAuth2 全局配置、授权会话到创建 Gmail 邮箱账户。',
        sections: TOC_OAUTH,
        primarySection: 'overview',
        icon: Shield,
        accent: 'from-blue-500 to-indigo-600',
        surface: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800/70',
        glow: 'shadow-blue-500/20',
        stats: ['6 步流程', 'OAuth2', 'Token 刷新'],
    },
    {
        id: 'mail-api',
        title: '邮件 API',
        eyebrow: 'Mailbox Automation',
        description: '通过 API 获取账户、同步读取邮件，并使用取件轮询等待验证码。',
        sections: TOC_MAIL_API,
        primarySection: 'mail-api-overview',
        icon: Mail,
        accent: 'from-emerald-500 to-teal-600',
        surface: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800/70',
        glow: 'shadow-emerald-500/20',
        stats: ['账户读取', '邮件搜索', '取件轮询'],
    },
    {
        id: 'deploy',
        title: '部署指南',
        eyebrow: 'Production Setup',
        description: '覆盖 Docker、Compose、K3s、Helm 和源码开发环境部署。',
        sections: TOC_DEPLOY,
        primarySection: 'deploy-overview',
        icon: Rocket,
        accent: 'from-cyan-500 to-blue-600',
        surface: 'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-300 dark:border-cyan-800/70',
        glow: 'shadow-cyan-500/20',
        stats: ['Docker', 'Kubernetes', '环境变量'],
    },
]

// ==================== 主组件 ====================

export default function IntegrationGuideTab() {
    const [activeGuide, setActiveGuide] = useState<GuideId>('mail-api')
    const activeDoc = GUIDE_DOCS.find((doc) => doc.id === activeGuide) || GUIDE_DOCS[0]
    const [activeSection, setActiveSection] = useState(activeDoc.primarySection)
    const contentRef = useRef<HTMLDivElement>(null)
    const activeSectionIndex = Math.max(0, activeDoc.sections.findIndex((section) => section.id === activeSection))
    const progressPercent = ((activeSectionIndex + 1) / activeDoc.sections.length) * 100
    const previousSection = activeDoc.sections[activeSectionIndex - 1]
    const nextSection = activeDoc.sections[activeSectionIndex + 1]

    // 滚动监听，自动高亮目录
    const handleScroll = useCallback(() => {
        if (!contentRef.current) return
        const sections = contentRef.current.querySelectorAll(`[data-guide="${activeGuide}"] [data-section]`)
        let current = activeDoc.primarySection
        sections.forEach((section) => {
            const el = section as HTMLElement
            const rect = el.getBoundingClientRect()
            if (rect.top <= 120) {
                current = el.dataset.section || 'overview'
            }
        })
        setActiveSection(current)
    }, [activeDoc.primarySection, activeGuide])

    useEffect(() => {
        const el = contentRef.current
        if (!el) return
        el.addEventListener('scroll', handleScroll)
        return () => el.removeEventListener('scroll', handleScroll)
    }, [handleScroll])

    const switchGuide = (id: GuideId) => {
        const nextDoc = GUIDE_DOCS.find((doc) => doc.id === id) || GUIDE_DOCS[0]
        setActiveGuide(id)
        setActiveSection(nextDoc.primarySection)
        requestAnimationFrame(() => {
            contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        })
    }

    const scrollTo = (id: string) => {
        const el = contentRef.current?.querySelector(`[data-guide="${activeGuide}"] [data-section="${id}"]`)
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
    }

    return (
        <div className="flex h-full">
            {/* 左侧目录导航 */}
            <aside className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 overflow-y-auto">
                <div className="p-4">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md shadow-blue-500/20">
                            <BookOpen className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-gray-900 dark:text-white">接入手册</h2>
                            <p className="text-[10px] text-gray-400">Integration Guide</p>
                        </div>
                    </div>

                    <nav className="space-y-5">
                        <div>
                            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">文档集</div>
                            <div className="space-y-2">
                                {GUIDE_DOCS.map((doc) => (
                                    <button
                                        key={doc.id}
                                        onClick={() => switchGuide(doc.id)}
                                        className={cn(
                                            'group w-full rounded-2xl border p-3 text-left transition-all duration-300',
                                            activeGuide === doc.id
                                                ? cn(doc.surface, 'shadow-sm')
                                                : 'border-transparent bg-white/60 text-gray-600 hover:border-gray-200 hover:bg-white dark:bg-gray-900/40 dark:text-gray-400 dark:hover:border-gray-800 dark:hover:bg-gray-900'
                                        )}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className={cn(
                                                'flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-md transition-transform duration-300 group-hover:scale-105',
                                                `bg-gradient-to-br ${doc.accent}`,
                                                doc.glow
                                            )}>
                                                <doc.icon className="h-4 w-4" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-bold text-gray-900 dark:text-white">{doc.title}</div>
                                                <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{doc.eyebrow}</div>
                                            </div>
                                        </div>
                                        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                                            {doc.description}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <div className="flex items-center justify-between px-3 py-1.5">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">当前目录</span>
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                    {activeDoc.sections.length}
                                </span>
                            </div>
                            <div className="mb-2 px-3">
                                <div className="mb-1 flex items-center justify-between text-[10px] text-gray-400">
                                    <span>阅读进度</span>
                                    <span>{activeSectionIndex + 1}/{activeDoc.sections.length}</span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                                    <div
                                        className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-500', activeDoc.accent)}
                                        style={{ width: `${progressPercent}%` }}
                                    />
                                </div>
                            </div>
                            <div className="space-y-0.5">
                                {activeDoc.sections.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => scrollTo(item.id)}
                                        className={cn(
                                            'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 text-left',
                                            activeSection === item.id
                                                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 hover:text-gray-700 dark:hover:text-gray-300'
                                        )}
                                    >
                                        <item.icon className="w-3.5 h-3.5 flex-shrink-0" />
                                        <span className="truncate">{item.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </nav>
                </div>
            </aside>

            {/* 右侧内容区 */}
            <div ref={contentRef} className="flex-1 overflow-y-auto">
                <div className="max-w-5xl mx-auto px-6 lg:px-8 py-8">
                    <div className="mb-8">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
                                    <BookOpen className="h-3.5 w-3.5" />
                                    Documentation Hub
                                </div>
                                <h1 className="mt-3 text-2xl font-extrabold text-gray-950 dark:text-white">
                                    接入手册
                                </h1>
                                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                                    按任务拆成独立文档页：接入 Gmail、调用邮件 API、部署上线。切换文档不会把你丢进一整页长滚动里。
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {activeDoc.stats.map((stat) => (
                                    <span key={stat} className={cn('rounded-full border px-3 py-1 text-xs font-medium', activeDoc.surface)}>
                                        {stat}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className="mt-5 grid gap-3 md:grid-cols-3">
                            {GUIDE_DOCS.map((doc) => (
                                <motion.button
                                    key={doc.id}
                                    type="button"
                                    onClick={() => switchGuide(doc.id)}
                                    whileHover={{ y: -3 }}
                                    whileTap={{ scale: 0.98 }}
                                    className={cn(
                                        'group relative overflow-hidden rounded-2xl border p-4 text-left shadow-sm transition-all duration-300',
                                        activeGuide === doc.id
                                            ? 'border-transparent bg-white shadow-lg dark:bg-gray-900'
                                            : 'border-gray-200 bg-white/70 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900/60 dark:hover:border-gray-700'
                                    )}
                                >
                                    <div className={cn(
                                        'absolute inset-x-0 top-0 h-1 bg-gradient-to-r transition-opacity duration-300',
                                        doc.accent,
                                        activeGuide === doc.id ? 'opacity-100' : 'opacity-30'
                                    )} />
                                    <div className="flex items-start justify-between gap-3">
                                        <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md', doc.accent, doc.glow)}>
                                            <doc.icon className="h-4 w-4" />
                                        </div>
                                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                            {doc.sections.length} 节
                                        </span>
                                    </div>
                                    <div className="mt-3 text-sm font-bold text-gray-950 dark:text-white">{doc.title}</div>
                                    <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{doc.description}</p>
                                </motion.button>
                            ))}
                        </div>
                    </div>

                    <AnimatePresence mode="wait">
                        {activeGuide === 'oauth' && (
                            <motion.div
                                key="oauth"
                                data-guide="oauth"
                                className="space-y-12"
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -12 }}
                                transition={{ duration: 0.22, ease: 'easeOut' }}
                            >

                    {/* ===== 概述 ===== */}
                    <section data-section="overview">
                        <div className="mb-6">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-medium mb-3">
                                <Mail className="w-3 h-3" />
                                Gmail OAuth2 接入
                            </div>
                            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-3">
                                通过 API 接口添加基于 OAuth 授权的 Gmail
                            </h1>
                            <p className="text-base text-gray-600 dark:text-gray-400 leading-relaxed">
                                本手册详细介绍如何通过调用 Mailman API 接口，以 OAuth2 授权方式添加 Gmail 邮箱账户。
                                整个流程涉及 OAuth2 配置、授权会话管理、Token 交换和账户创建等多个步骤。
                            </p>
                        </div>

                        {/* 流程图 */}
                        <OAuthFlowDiagram />
                    </section>

                    {/* ===== 前置条件 ===== */}
                    <section data-section="prerequisites">
                        <StepIndicator step={0} title="前置条件" />
                        <div className="pl-12 space-y-3">
                            <div className="space-y-2">
                                {[
                                    '已在 Google Cloud Console 创建 OAuth2 应用并获取 client_id 和 client_secret',
                                    'Mailman 后端服务已运行',
                                    '已获取 Mailman 的认证 Token（用于 API 调用的 Authorization header）',
                                ].map((item, idx) => (
                                    <div key={idx} className="flex items-start gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                                        <span className="text-sm text-gray-700 dark:text-gray-300">{item}</span>
                                    </div>
                                ))}
                            </div>
                            <Callout type="info">
                                以下示例中 <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">BASE_URL</code> 为你的 Mailman 后端地址（如 <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">http://localhost:8080</code>），
                                <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">AUTH_TOKEN</code> 为你的 JWT 认证 Token。
                            </Callout>
                        </div>
                    </section>

                    {/* ===== 步骤 1 ===== */}
                    <section data-section="step-1">
                        <StepIndicator step={1} title="配置 OAuth2 全局配置" active />

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                首先需要在系统中注册你的 Google OAuth2 应用信息。如果已经配置过，可以跳过此步骤。
                            </p>

                            <div className="flex items-center gap-2 mb-2">
                                <MethodBadge method="POST" />
                                <code className="text-sm font-mono text-gray-800 dark:text-gray-200">/api/oauth2/global-config</code>
                            </div>

                            <CollapsibleCode
                                title="创建/更新 OAuth2 全局配置"
                                defaultOpen={true}
                                code={`curl -X POST "\${BASE_URL}/api/oauth2/global-config" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${AUTH_TOKEN}" \\
  -d '{
    "name": "Gmail OAuth2",
    "provider_type": "gmail",
    "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    "client_secret": "YOUR_GOOGLE_CLIENT_SECRET",
    "redirect_uri": "http://localhost:8080/api/oauth2/callback/gmail",
    "is_enabled": true
  }'`}
                            />

                            <Callout type="info">
                                <code className="font-mono text-xs">scopes</code> 字段<strong>不需要手动填写</strong>，系统会自动强制 Gmail 使用以下固定 scopes：
                                <ul className="mt-1 space-y-0.5 list-disc pl-4">
                                    <li><code className="font-mono text-xs">https://mail.google.com/</code></li>
                                    <li><code className="font-mono text-xs">https://www.googleapis.com/auth/userinfo.email</code></li>
                                    <li><code className="font-mono text-xs">https://www.googleapis.com/auth/userinfo.profile</code></li>
                                </ul>
                            </Callout>

                            <CollapsibleCode
                                title="响应示例"
                                language="json"
                                code={`{
  "id": 1,
  "name": "Gmail OAuth2",
  "provider_type": "gmail",
  "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
  "client_secret": "YOUR_GOOGLE_CLIENT_SECRET",
  "redirect_uri": "http://localhost:8080/api/oauth2/callback/gmail",
  "scopes": [
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile"
  ],
  "is_enabled": true,
  "created_at": "2026-05-22T17:00:00Z",
  "updated_at": "2026-05-22T17:00:00Z"
}`}
                            />

                            <CollapsibleCode
                                title="查看已有配置（可选）"
                                code={`# 获取所有 OAuth2 配置
curl "\${BASE_URL}/api/oauth2/global-configs" \\
  -H "Authorization: Bearer \${AUTH_TOKEN}"

# 获取 Gmail 类型的配置
curl "\${BASE_URL}/api/oauth2/global-configs/gmail" \\
  -H "Authorization: Bearer \${AUTH_TOKEN}"

# 按 ID 获取
curl "\${BASE_URL}/api/oauth2/global-config/by-id/1" \\
  -H "Authorization: Bearer \${AUTH_TOKEN}"`}
                            />
                        </div>
                    </section>

                    {/* ===== 步骤 2 ===== */}
                    <section data-section="step-2">
                        <StepIndicator step={2} title="启动 OAuth2 授权会话" active />

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                这一步会创建一个授权会话，并返回 Google 的授权 URL。
                            </p>

                            <div className="flex items-center gap-2 mb-2">
                                <MethodBadge method="POST" />
                                <code className="text-sm font-mono text-gray-800 dark:text-gray-200">/api/oauth2/session/start/gmail</code>
                            </div>

                            <CollapsibleCode
                                title="启动 OAuth2 会话"
                                defaultOpen={true}
                                code={`curl -X POST "\${BASE_URL}/api/oauth2/session/start/gmail?config_id=1" \\
  -H "Authorization: Bearer \${AUTH_TOKEN}"`}
                            />

                            <Callout type="tip">
                                <code className="font-mono text-xs">config_id</code> 参数是可选的。如果你只有一个 Gmail OAuth2 配置，可以省略；如果有多个配置，需要通过 <code className="font-mono text-xs">config_id</code> 指定使用哪一个。
                            </Callout>

                            <CollapsibleCode
                                title="响应示例"
                                language="json"
                                code={`{
  "session_id": 42,
  "state": "aB3dEfGhIjKlMnOpQrStUvWxYz123456",
  "auth_url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=...&response_type=code&scope=...&state=aB3dEfGhIjKlMnOpQrStUvWxYz123456&access_type=offline&prompt=consent",
  "expires_at": 1748019600
}`}
                            />

                            <FieldTable fields={[
                                { name: 'session_id', type: 'number', desc: '会话 ID' },
                                { name: 'state', type: 'string', desc: '安全状态参数，后续轮询需要用到' },
                                { name: 'auth_url', type: 'string', required: true, desc: '需要让用户在浏览器中打开的 Google 授权 URL' },
                                { name: 'expires_at', type: 'number', desc: '会话过期时间戳（10分钟后过期）' },
                            ]} />
                        </div>
                    </section>

                    {/* ===== 步骤 3 ===== */}
                    <section data-section="step-3">
                        <StepIndicator step={3} title="用户完成 Google 授权" active />

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                将上一步获取的 <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">auth_url</code> 在浏览器中打开（或通知用户打开）。
                                用户会看到 Google 的授权页面，选择 Google 账号并同意授权。
                            </p>

                            <Callout type="important">
                                这一步是<strong>异步的</strong>，需要等待用户在浏览器中完成操作。API 调用方无法直接替代用户完成授权，因为这是 OAuth2 安全模型的核心要求。
                            </Callout>

                            <div className="p-4 rounded-xl bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-800/50 dark:to-blue-900/20 border border-gray-200 dark:border-gray-700">
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">回调成功后，后端会自动：</p>
                                <ol className="space-y-1.5 text-sm text-gray-600 dark:text-gray-400">
                                    <li className="flex items-start gap-2">
                                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-[10px] font-bold flex-shrink-0 mt-0.5">1</span>
                                        用授权码（code）向 Google 换取 access_token 和 refresh_token
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-[10px] font-bold flex-shrink-0 mt-0.5">2</span>
                                        用 access_token 获取用户的邮箱地址和个人信息
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-[10px] font-bold flex-shrink-0 mt-0.5">3</span>
                                        将所有信息保存到授权会话中
                                    </li>
                                </ol>
                            </div>
                        </div>
                    </section>

                    {/* ===== 步骤 4 ===== */}
                    <section data-section="step-4">
                        <StepIndicator step={4} title="轮询授权会话状态" active />

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                在用户操作期间，API 调用方应该<strong>轮询</strong>会话状态，直到状态变为 success 或 failed。
                            </p>

                            <div className="flex items-center gap-2 mb-2">
                                <MethodBadge method="GET" />
                                <code className="text-sm font-mono text-gray-800 dark:text-gray-200">{'/api/oauth2/session/poll/{state}'}</code>
                            </div>

                            <CollapsibleCode
                                title="轮询会话状态"
                                defaultOpen={true}
                                code={`# 使用步骤 2 中获取的 state 值
curl "\${BASE_URL}/api/oauth2/session/poll/aB3dEfGhIjKlMnOpQrStUvWxYz123456" \\
  -H "Authorization: Bearer \${AUTH_TOKEN}"`}
                            />

                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">状态说明</h4>
                            <StatusTable />

                            <Callout type="tip">
                                建议每 2-3 秒轮询一次，直到状态不再是 <code className="font-mono text-xs">pending</code>。
                            </Callout>

                            <CollapsibleCode
                                title="success 状态响应示例"
                                language="json"
                                code={`{
  "status": "success",
  "expires_at": 1748019600,
  "emailAddress": "user@gmail.com",
  "customSettings": {
    "access_token": "ya29.xxx...",
    "refresh_token": "1//xxx...",
    "token_type": "Bearer",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET"
  }
}`}
                            />

                            <CollapsibleCode
                                title="轮询脚本示例 (Shell)"
                                code={`STATE="aB3dEfGhIjKlMnOpQrStUvWxYz123456"

while true; do
  RESPONSE=$(curl -s "\${BASE_URL}/api/oauth2/session/poll/\${STATE}" \\
    -H "Authorization: Bearer \${AUTH_TOKEN}")
  
  STATUS=$(echo $RESPONSE | jq -r '.status')
  echo "当前状态: $STATUS"
  
  if [ "$STATUS" = "success" ]; then
    echo "✅ 授权成功!"
    echo "邮箱: $(echo $RESPONSE | jq -r '.emailAddress')"
    break
  elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "expired" ]; then
    echo "❌ 授权失败: $STATUS"
    break
  fi
  
  sleep 3
done`}
                            />
                        </div>
                    </section>

                    {/* ===== 步骤 5 ===== */}
                    <section data-section="step-5">
                        <StepIndicator step={5} title="创建邮箱账户" active />

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                授权成功后，使用轮询获取的信息创建邮箱账户。
                            </p>

                            <div className="flex items-center gap-2 mb-2">
                                <MethodBadge method="POST" />
                                <code className="text-sm font-mono text-gray-800 dark:text-gray-200">/api/accounts</code>
                            </div>

                            <CollapsibleCode
                                title="创建邮箱账户"
                                defaultOpen={true}
                                code={`curl -X POST "\${BASE_URL}/api/accounts" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${AUTH_TOKEN}" \\
  -d '{
    "emailAddress": "user@gmail.com",
    "authType": "oauth2",
    "oauth2ProviderId": 1,
    "customSettings": {
      "access_token": "ya29.xxx...",
      "refresh_token": "1//xxx...",
      "token_type": "Bearer"
    }
  }'`}
                            />

                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">请求字段说明</h4>
                            <FieldTable fields={[
                                { name: 'emailAddress', type: 'string', required: true, desc: '从轮询结果的 emailAddress 获取' },
                                { name: 'authType', type: 'string', required: true, desc: '固定为 "oauth2"' },
                                { name: 'oauth2ProviderId', type: 'uint', desc: '关联的 OAuth2 全局配置 ID' },
                                { name: 'mailProviderId', type: 'uint', desc: '邮件服务提供商 ID' },
                                { name: 'customSettings', type: 'object', required: true, desc: '包含 tokens 和认证信息' },
                                { name: 'proxy', type: 'string', desc: '代理设置，如 socks5://user:pass@host:port' },
                            ]} />

                            <Callout type="tip">
                                也可以使用 <code className="font-mono text-xs">POST /api/accounts/upsert</code> 接口——如果账户已存在则自动更新。
                            </Callout>
                        </div>
                    </section>

                    {/* ===== 步骤 6 ===== */}
                    <section data-section="step-6">
                        <StepIndicator step={6} title="验证账户连通性（可选）" />

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                创建账户后，可以验证账户是否能正常连接。
                            </p>

                            <div className="flex items-center gap-2 mb-2">
                                <MethodBadge method="POST" />
                                <code className="text-sm font-mono text-gray-800 dark:text-gray-200">/api/accounts/verify</code>
                            </div>

                            <CollapsibleCode
                                title="验证账户连通性"
                                defaultOpen={true}
                                code={`curl -X POST "\${BASE_URL}/api/accounts/verify" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${AUTH_TOKEN}" \\
  -d '{
    "account_id": 10
  }'`}
                            />

                            <CollapsibleCode
                                title="响应示例"
                                language="json"
                                code={`{
  "success": true,
  "message": "Connection verified successfully"
}`}
                            />
                        </div>
                    </section>

                    {/* ===== API 接口参考 ===== */}
                    <section data-section="api-reference">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-sm">
                                <Database className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">完整 API 接口参考</h3>
                        </div>

                        <div className="space-y-6 pl-12">
                            {/* OAuth2 配置管理 */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                                    <Key className="w-4 h-4 text-blue-500" /> OAuth2 配置管理
                                </h4>
                                <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                                    <ApiEndpoint method="POST" path="/api/oauth2/global-config" description="创建/更新 OAuth2 全局配置" />
                                    <ApiEndpoint method="GET" path="/api/oauth2/global-configs" description="获取所有 OAuth2 配置" />
                                    <ApiEndpoint method="GET" path="/api/oauth2/global-configs/{provider}" description="按提供商类型获取配置" />
                                    <ApiEndpoint method="GET" path="/api/oauth2/global-config/by-id/{id}" description="按 ID 获取配置" />
                                    <ApiEndpoint method="DELETE" path="/api/oauth2/global-config/{id}" description="删除配置" />
                                    <ApiEndpoint method="POST" path="/api/oauth2/provider/{provider}/enable" description="启用提供商" />
                                    <ApiEndpoint method="POST" path="/api/oauth2/provider/{provider}/disable" description="禁用提供商" />
                                </div>
                            </div>

                            {/* OAuth2 授权会话 */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                                    <Shield className="w-4 h-4 text-indigo-500" /> OAuth2 授权会话
                                </h4>
                                <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                                    <ApiEndpoint method="POST" path="/api/oauth2/session/start/{provider}" description="启动授权会话" />
                                    <ApiEndpoint method="GET" path="/api/oauth2/session/poll/{state}" description="轮询会话状态" />
                                    <ApiEndpoint method="POST" path="/api/oauth2/session/cancel/{state}" description="取消授权会话" />
                                    <ApiEndpoint method="GET" path="/api/oauth2/callback/{provider}" description="OAuth2 回调（Google 自动调用）" />
                                </div>
                            </div>

                            {/* Token 管理 */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                                    <RefreshCw className="w-4 h-4 text-emerald-500" /> OAuth2 Token 管理
                                </h4>
                                <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                                    <ApiEndpoint method="POST" path="/api/oauth2/exchange-token" description="手动用授权码换取 tokens" />
                                    <ApiEndpoint method="POST" path="/api/oauth2/refresh-token" description="刷新 access_token" />
                                </div>
                            </div>

                            {/* 邮箱账户管理 */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                                    <Mail className="w-4 h-4 text-amber-500" /> 邮箱账户管理
                                </h4>
                                <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                                    <ApiEndpoint method="POST" path="/api/accounts" description="创建邮箱账户" />
                                    <ApiEndpoint method="POST" path="/api/accounts/upsert" description="创建或更新邮箱账户" />
                                    <ApiEndpoint method="POST" path="/api/accounts/verify" description="验证账户连通性" />
                                    <ApiEndpoint method="GET" path="/api/accounts" description="获取所有账户" />
                                    <ApiEndpoint method="GET" path="/api/accounts/{id}" description="获取单个账户" />
                                    <ApiEndpoint method="PUT" path="/api/accounts/{id}" description="更新账户" />
                                    <ApiEndpoint method="DELETE" path="/api/accounts/{id}" description="删除账户" />
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* ===== 替代方案 ===== */}
                    <section data-section="alternative">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm">
                                <ArrowRight className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">替代方案：手动 Token 交换</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                如果你已经通过其他方式获得了 Google 的授权码（code），可以跳过步骤 2-4，直接使用手动 Token 交换接口：
                            </p>

                            <CollapsibleCode
                                title="手动用授权码换取 tokens"
                                defaultOpen={true}
                                code={`curl -X POST "\${BASE_URL}/api/oauth2/exchange-token" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${AUTH_TOKEN}" \\
  -d '{
    "provider": "gmail",
    "code": "4/0AQlEd8...",
    "redirect_uri": "http://localhost:8080/api/oauth2/callback/gmail",
    "config_id": 1
  }'`}
                            />

                            <CollapsibleCode
                                title="响应示例"
                                language="json"
                                code={`{
  "access_token": "ya29.xxx...",
  "refresh_token": "1//xxx...",
  "provider": "gmail",
  "expires_at": 1748023200
}`}
                            />

                            <Callout type="tip">
                                获取到 tokens 后，直接跳到步骤 5 创建账户即可。
                            </Callout>
                        </div>
                    </section>

                    {/* ===== 刷新 Token ===== */}
                    <section data-section="refresh-token">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
                                <RefreshCw className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">刷新 Token</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                OAuth2 access_token 通常 1 小时后过期。系统在执行邮件同步时会自动刷新 token。你也可以手动刷新：
                            </p>

                            <CollapsibleCode
                                title="手动刷新 Token"
                                defaultOpen={true}
                                code={`curl -X POST "\${BASE_URL}/api/oauth2/refresh-token" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer \${AUTH_TOKEN}" \\
  -d '{
    "provider": "gmail",
    "refresh_token": "1//xxx...",
    "config_id": 1,
    "account_id": 10
  }'`}
                            />
                        </div>
                    </section>

                    {/* ===== FAQ ===== */}
                    <section data-section="faq">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-gray-600 to-gray-800 text-white shadow-sm">
                                <AlertCircle className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">常见问题</h3>
                        </div>

                        <div className="pl-12 space-y-3">
                            {[
                                {
                                    q: '我可以完全不经过浏览器来添加 Gmail 吗？',
                                    a: '不可以。OAuth2 的安全模型要求用户必须在 Google 的页面上亲自登录并授权。API 只能帮你生成授权 URL 和处理回调后的结果。',
                                },
                                {
                                    q: 'redirect_uri 应该怎么配置？',
                                    a: 'redirect_uri 必须指向 Mailman 后端的回调接口：{BACKEND_URL}/api/oauth2/callback/gmail。同时需要在 Google Cloud Console 的 OAuth2 客户端中添加相同的 URI 作为授权重定向 URI。',
                                },
                                {
                                    q: 'Token 过期了怎么办？',
                                    a: 'Mailman 系统在同步邮件时会自动使用 refresh_token 刷新 access_token。只要 refresh_token 有效（用户未撤销授权），就无需手动干预。',
                                },
                                {
                                    q: '如何判断某个账户的 OAuth2 Token 是否有效？',
                                    a: '调用 POST /api/accounts/verify 验证账户。如果 Token 失效，账户的 errorStatus 字段会被设置为 oauth_expired。',
                                },
                            ].map((faq, idx) => (
                                <FAQItem key={idx} question={faq.q} answer={faq.a} />
                            ))}
                        </div>
                    </section>
                            </motion.div>
                        )}

                    {/* ============================================================ */}
                    {/* ==================== 邮件 API 接入 ==================== */}
                    {/* ============================================================ */}
                        {activeGuide === 'mail-api' && (
                            <motion.div
                                key="mail-api"
                                data-guide="mail-api"
                                className="space-y-12"
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -12 }}
                                transition={{ duration: 0.22, ease: 'easeOut' }}
                            >

                    {/* 分隔线 */}
                    <div className="relative py-8">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t-2 border-dashed border-gray-200 dark:border-gray-700" />
                        </div>
                        <div className="relative flex justify-center">
                            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-bold shadow-lg shadow-emerald-500/25">
                                <Mail className="w-3.5 h-3.5" />
                                邮件 API
                            </span>
                        </div>
                    </div>

                    <section data-section="mail-api-overview">
                        <div className="mb-6">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium mb-3">
                                <Database className="w-3 h-3" />
                                Mail API Workflow
                            </div>
                            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-3">
                                通过 API 获取邮箱账户、读取邮件与执行取件
                            </h1>
                            <p className="text-base text-gray-600 dark:text-gray-400 leading-relaxed">
                                本文档基于后端实际路由和新版取件页面的调用链编写，覆盖从登录、获取账户、同步邮件、读取邮件详情，到使用统一取件轮询接口等待并提取邮件内容的完整流程。
                            </p>
                        </div>

                        <div className="grid md:grid-cols-3 gap-3 my-6">
                            {[
                                { title: '1. 获取账户', desc: '登录后通过 /accounts 或 /accounts/paginated 获取可用邮箱账户。', icon: Database },
                                { title: '2. 读取邮件', desc: '先同步账户邮件，再用列表/搜索/详情接口读取数据库中的邮件。', icon: Search },
                                { title: '3. 取件轮询', desc: '使用 /pickup/poll 临时拉取、搜索并可选执行提取。', icon: Zap },
                            ].map((item) => (
                                <div key={item.title} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900">
                                    <item.icon className="w-5 h-5 text-emerald-500 mb-2" />
                                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{item.title}</h4>
                                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{item.desc}</p>
                                </div>
                            ))}
                        </div>

                        <Callout type="important">
                            以下示例统一使用 <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">API_BASE=http://localhost:8080/api</code>，也就是已经包含 <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">/api</code> 前缀。除登录接口外，其余接口都需要携带 <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">Authorization: Bearer TOKEN</code>。
                        </Callout>
                    </section>

                    <section data-section="mail-api-auth">
                        <StepIndicator step={1} title="登录并获取访问令牌" active />
                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                API 调用方需要先登录获取 JWT。后端登录接口返回的 <code className="font-mono text-xs">token</code> 用于后续所有受保护接口。
                            </p>

                            <div className="flex items-center gap-2 mb-2">
                                <MethodBadge method="POST" />
                                <code className="text-sm font-mono text-gray-800 dark:text-gray-200">/api/auth/login</code>
                            </div>

                            <CollapsibleCode
                                title="登录获取 Token"
                                defaultOpen={true}
                                code={`API_BASE="http://localhost:8080/api"

TOKEN=$(curl -s -X POST "\${API_BASE}/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{
    "username": "admin@example.com",
    "password": "your_password"
  }' | jq -r '.token')

echo "\${TOKEN}"`}
                            />

                            <FieldTable fields={[
                                { name: 'token', type: 'string', required: true, desc: 'Bearer Token，后续请求放入 Authorization header' },
                                { name: 'expires_at', type: 'string', desc: 'Token 过期时间，RFC3339 格式' },
                                { name: 'user', type: 'object', desc: '当前登录用户基础信息' },
                            ]} />
                        </div>
                    </section>

                    <section data-section="mail-api-accounts">
                        <StepIndicator step={2} title="获取邮箱账户" active />
                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                读取邮件前，需要拿到邮箱账户 ID。推荐使用分页接口，它支持搜索、排序和过滤；如果只需要全量账户，也可以调用 <code className="font-mono text-xs">GET /api/accounts</code>。
                            </p>

                            <div className="flex items-center gap-2 mb-2">
                                <MethodBadge method="GET" />
                                <code className="text-sm font-mono text-gray-800 dark:text-gray-200">/api/accounts/paginated</code>
                            </div>

                            <CollapsibleCode
                                title="分页获取账户"
                                defaultOpen={true}
                                code={`curl "\${API_BASE}/accounts/paginated?page=1&limit=20&search=gmail&sort_by=created_at&sort_order=desc" \\
  -H "Authorization: Bearer \${TOKEN}"`}
                            />

                            <CollapsibleCode
                                title="响应结构示例"
                                language="json"
                                code={`{
  "data": [
    {
      "id": 10,
      "emailAddress": "user@gmail.com",
      "authType": "oauth2",
      "mailProviderId": 1,
      "isDomainMail": false,
      "domain": "",
      "isVerified": true,
      "lastSyncAt": "2026-05-29T08:10:00Z",
      "errorStatus": "normal"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20,
  "total_pages": 1
}`}
                            />

                            <FieldTable fields={[
                                { name: 'page', type: 'number', desc: '页码，默认 1' },
                                { name: 'limit', type: 'number', desc: '每页数量，最大 100' },
                                { name: 'search', type: 'string', desc: '按邮箱地址搜索' },
                                { name: 'provider_id', type: 'number', desc: '按邮件服务商过滤' },
                                { name: 'is_verified', type: 'string', desc: 'true 或 false' },
                                { name: 'error_status', type: 'string', desc: '例如 normal、oauth_expired、network_error' },
                            ]} />
                        </div>
                    </section>

                    <section data-section="mail-api-read">
                        <StepIndicator step={3} title="同步并读取邮件" active />
                        <div className="pl-12 space-y-5">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                邮件列表接口读取的是数据库中的邮件。想拿最新邮件时，先调用同步接口把 IMAP 服务器上的邮件拉入数据库，再调用列表、搜索或详情接口。
                            </p>

                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                                    <RefreshCw className="w-4 h-4 text-blue-500" /> 1. 同步账户邮件
                                </h4>
                                <div className="flex items-center gap-2 mb-2">
                                    <MethodBadge method="POST" />
                                    <code className="text-sm font-mono text-gray-800 dark:text-gray-200">{'/api/account-emails/fetch/{account_id}'}</code>
                                </div>
                                <CollapsibleCode
                                    title="增量同步最近邮件"
                                    defaultOpen={true}
                                    code={`ACCOUNT_ID=10
SINCE=$(node -e "console.log(new Date(Date.now() - 60 * 60 * 1000).toISOString())")

curl -X POST "\${API_BASE}/account-emails/fetch/\${ACCOUNT_ID}" \\
  -H "Authorization: Bearer \${TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"sync_mode\\": \\"incremental\\",
    \\"mailboxes\\": [\\"INBOX\\"],
    \\"default_start_date\\": \\"\${SINCE}\\",
    \\"max_emails_per_mailbox\\": 50,
    \\"include_body\\": true
  }"`}
                                />
                                <Callout type="tip">
                                    <code className="font-mono text-xs">sync_mode</code> 默认为 <code className="font-mono text-xs">incremental</code>，没有历史同步记录时会使用 <code className="font-mono text-xs">default_start_date</code> 作为起点。读取正文或后续要做提取时，建议传 <code className="font-mono text-xs">include_body: true</code>。
                                </Callout>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                                    <Search className="w-4 h-4 text-emerald-500" /> 2. 读取账户邮件列表
                                </h4>
                                <div className="flex items-center gap-2 mb-2">
                                    <MethodBadge method="GET" />
                                    <code className="text-sm font-mono text-gray-800 dark:text-gray-200">{'/api/account-emails/list/{account_id}'}</code>
                                </div>
                                <CollapsibleCode
                                    title="读取最近邮件"
                                    defaultOpen={true}
                                    code={`curl "\${API_BASE}/account-emails/list/\${ACCOUNT_ID}?limit=20&offset=0&sort_by=date_desc&mailbox=INBOX&direction=received" \\
  -H "Authorization: Bearer \${TOKEN}"`}
                                />
                                <FieldTable fields={[
                                    { name: 'limit', type: 'number', desc: '返回数量，默认 50，最大 100' },
                                    { name: 'offset', type: 'number', desc: '分页偏移量' },
                                    { name: 'sort_by', type: 'string', desc: 'date_desc、date_asc、subject_asc、subject_desc' },
                                    { name: 'from_query/to_query', type: 'string', desc: '按发件人或收件人模糊搜索' },
                                    { name: 'subject_query/body_query/html_query', type: 'string', desc: '按主题、文本正文或 HTML 正文搜索' },
                                    { name: 'keyword', type: 'string', desc: '跨发件人、收件人、主题、正文的全局关键词' },
                                    { name: 'direction', type: 'string', desc: 'received、sent、all' },
                                ]} />
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                                    <Globe className="w-4 h-4 text-purple-500" /> 3. 全局搜索与域名/别名收件人搜索
                                </h4>
                                <div className="flex items-center gap-2 mb-2">
                                    <MethodBadge method="GET" />
                                    <code className="text-sm font-mono text-gray-800 dark:text-gray-200">/api/emails/search</code>
                                </div>
                                <CollapsibleCode
                                    title="按收件地址搜索"
                                    code={`curl "\${API_BASE}/emails/search?account_id=\${ACCOUNT_ID}&to_query=code@example.com&start_date=\${SINCE}&limit=10&sort_by=date_desc" \\
  -H "Authorization: Bearer \${TOKEN}"`}
                                />
                                <Callout type="info">
                                    <code className="font-mono text-xs">to_query</code> 会走收件人搜索增强逻辑：Gmail 别名会尝试点号、加号、googlemail.com 变体；域名邮箱账户会尝试匹配同域名收件地址。该接口在传入 <code className="font-mono text-xs">to_query</code> 时，也会尝试触发对应账户订阅的立即同步；即便同步失败，也会继续返回数据库中已存在的邮件。
                                </Callout>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-amber-500" /> 4. 读取单封邮件详情
                                </h4>
                                <div className="flex items-center gap-2 mb-2">
                                    <MethodBadge method="GET" />
                                    <code className="text-sm font-mono text-gray-800 dark:text-gray-200">{'/api/emails/{email_id}'}</code>
                                </div>
                                <CollapsibleCode
                                    title="读取详情"
                                    code={`EMAIL_ID=123

curl "\${API_BASE}/emails/\${EMAIL_ID}" \\
  -H "Authorization: Bearer \${TOKEN}"`}
                                />
                            </div>
                        </div>
                    </section>

                    <section data-section="mail-api-pickup">
                        <StepIndicator step={4} title="使用统一取件轮询接口" active />
                        <div className="pl-12 space-y-5">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                新版取件页面实际使用 <code className="font-mono text-xs">POST /api/pickup/poll</code>。这个接口把“临时同步续期、立即同步、搜索邮件、执行提取”合成一次请求，适合验证码、登录确认邮件、一次性通知等需要短时间等待的场景。
                            </p>

                            <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
                                {[
                                    ['注册/续期临时同步覆盖', '默认 sync_interval=5 秒，keep_alive_seconds=30 秒；每次调用都会续期。'],
                                    ['立即同步一次', '服务端会调用 SyncNow，确保刚到达的邮件尽快入库。'],
                                    ['按 account_id、since、to_query 搜索邮件', 'since 必须是 RFC3339 时间；to_query 可用于别名或域名邮箱收件地址。'],
                                    ['可选执行提取', 'template_id、inline_actions、simple_extract 三选一；都不传则只返回邮件。'],
                                ].map(([title, desc], idx) => (
                                    <div key={title} className="flex items-start gap-3 px-4 py-3">
                                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-xs font-bold flex-shrink-0">{idx + 1}</span>
                                        <div>
                                            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center gap-2 mb-2">
                                <MethodBadge method="POST" />
                                <code className="text-sm font-mono text-gray-800 dark:text-gray-200">/api/pickup/poll</code>
                            </div>

                            <CollapsibleCode
                                title="等待验证码邮件并提取 6 位数字"
                                defaultOpen={true}
                                code={`SINCE=$(node -e "console.log(new Date(Date.now() - 5 * 60 * 1000).toISOString())")

curl -X POST "\${API_BASE}/pickup/poll" \\
  -H "Authorization: Bearer \${TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d "{
    \\"account_id\\": \${ACCOUNT_ID},
    \\"keep_alive_seconds\\": 60,
    \\"sync_interval\\": 5,
    \\"since\\": \\"\${SINCE}\\",
    \\"to_query\\": \\"code@example.com\\",
    \\"limit\\": 5,
    \\"simple_extract\\": {
      \\"field\\": \\"body\\",
      \\"type\\": \\"regex\\",
      \\"pattern\\": \\"验证码[:：\\\\s]*([0-9]{6})|||\\$1\\",
      \\"match_mode\\": \\"first\\"
    }
  }"`}
                            />

                            <CollapsibleCode
                                title="响应结构示例"
                                language="json"
                                code={`{
  "success": true,
  "emails": [
    {
      "ID": 123,
      "AccountID": 10,
      "Subject": "您的验证码",
      "From": ["Example <notice@example.com>"],
      "To": ["code@example.com"],
      "Date": "2026-05-29T08:15:00Z",
      "Body": "验证码：123456",
      "MailboxName": "INBOX",
      "direction": "received"
    }
  ],
  "new_count": 1,
  "extractions": [
    {
      "email_id": 123,
      "success": true,
      "status": "success",
      "extracted_value": "123456"
    }
  ],
  "sync_active": true,
  "sync_expires_at": "2026-05-29T08:16:00Z"
}`}
                            />

                            <FieldTable fields={[
                                { name: 'account_id', type: 'number', required: true, desc: '邮箱账户 ID' },
                                { name: 'keep_alive_seconds', type: 'number', desc: '临时同步覆盖有效期，默认 30 秒' },
                                { name: 'sync_interval', type: 'number', desc: '临时同步间隔，默认 5 秒' },
                                { name: 'since', type: 'string', desc: '搜索起始时间，RFC3339 格式' },
                                { name: 'to_query', type: 'string', desc: '收件人过滤，可用于别名或域名邮箱地址' },
                                { name: 'limit', type: 'number', desc: '返回邮件数量，默认 10' },
                                { name: 'template_id', type: 'number', desc: '使用已有 V2 取件模板执行提取' },
                                { name: 'simple_extract', type: 'object', desc: '简单提取配置，支持 regex、js、gotemplate' },
                            ]} />

                            <Callout type="tip">
                                如果需要等待一段时间，客户端可以每 5 秒调用一次 <code className="font-mono text-xs">/pickup/poll</code>，直到 <code className="font-mono text-xs">emails.length &gt; 0</code> 或 <code className="font-mono text-xs">extractions</code> 中出现 <code className="font-mono text-xs">status=success</code>。每次调用都会刷新临时同步覆盖的过期时间。
                            </Callout>
                        </div>
                    </section>

                    <section data-section="mail-api-code">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-slate-600 to-gray-800 text-white shadow-sm">
                                <Code2 className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">完整 Node.js 调用示例</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                下面的脚本演示完整流程：登录、获取第一个账户、同步最近邮件、读取邮件列表、读取详情、轮询取件并提取验证码。
                            </p>

                            <CollapsibleCode
                                title="mailman-mail-api-demo.mjs"
                                language="js"
                                defaultOpen={true}
                                code={`const API_BASE = process.env.API_BASE || 'http://localhost:8080/api'
const USERNAME = process.env.MAILMAN_USERNAME || 'admin@example.com'
const PASSWORD = process.env.MAILMAN_PASSWORD || 'your_password'

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}),
    ...(options.headers || {}),
  }

  const response = await fetch(API_BASE + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    throw new Error(response.status + ' ' + await response.text())
  }

  return response.json()
}

const login = await request('/auth/login', {
  method: 'POST',
  body: { username: USERNAME, password: PASSWORD },
})
const token = login.token

const accountsPage = await request('/accounts/paginated?page=1&limit=10&sort_by=created_at&sort_order=desc', { token })
const account = accountsPage.data?.[0]
if (!account) throw new Error('No email account found')

const accountId = account.id
const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()

await request('/account-emails/fetch/' + accountId, {
  method: 'POST',
  token,
  body: {
    sync_mode: 'incremental',
    mailboxes: ['INBOX'],
    default_start_date: since,
    max_emails_per_mailbox: 50,
    include_body: true,
  },
})

const searchParams = new URLSearchParams({
  account_id: String(accountId),
  start_date: since,
  limit: '10',
  sort_by: 'date_desc',
  direction: 'received',
})
const list = await request('/emails/search?' + searchParams.toString(), { token })
console.log('emails found:', list.emails.length)

if (list.emails[0]) {
  const detail = await request('/emails/' + list.emails[0].ID, { token })
  console.log('latest subject:', detail.Subject)
}

const pickup = await request('/pickup/poll', {
  method: 'POST',
  token,
  body: {
    account_id: accountId,
    keep_alive_seconds: 60,
    sync_interval: 5,
    since,
    to_query: account.emailAddress,
    limit: 5,
    simple_extract: {
      field: 'body',
      type: 'regex',
      pattern: '验证码[:：\\\\s]*([0-9]{6})|||$1',
      match_mode: 'first',
    },
  },
})

console.log(JSON.stringify({
  account: account.emailAddress,
  pickup_emails: pickup.emails.length,
  extraction: pickup.extractions?.[0],
  sync_expires_at: pickup.sync_expires_at,
}, null, 2))`}
                            />

                            <CollapsibleCode
                                title="运行方式"
                                code={`API_BASE="http://localhost:8080/api" \\
MAILMAN_USERNAME="admin@example.com" \\
MAILMAN_PASSWORD="your_password" \\
node mailman-mail-api-demo.mjs`}
                            />

                            <Callout type="warning">
                                <code className="font-mono text-xs">since</code> 必须是 RFC3339 时间。跨平台脚本建议像上面的 Node.js 示例一样使用 <code className="font-mono text-xs">new Date(...).toISOString()</code> 生成。
                            </Callout>
                        </div>
                    </section>
                            </motion.div>
                        )}

                    {/* ============================================================ */}
                    {/* ==================== 部署指南 ==================== */}
                    {/* ============================================================ */}
                        {activeGuide === 'deploy' && (
                            <motion.div
                                key="deploy"
                                data-guide="deploy"
                                className="space-y-12"
                                initial={{ opacity: 0, y: 16 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -12 }}
                                transition={{ duration: 0.22, ease: 'easeOut' }}
                            >

                    {/* 分隔线 */}
                    <div className="relative py-8">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t-2 border-dashed border-gray-200 dark:border-gray-700" />
                        </div>
                        <div className="relative flex justify-center">
                            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-bold shadow-lg shadow-blue-500/25">
                                <Rocket className="w-3.5 h-3.5" />
                                部署指南
                            </span>
                        </div>
                    </div>

                    {/* ===== 部署概述 ===== */}
                    <section data-section="deploy-overview">
                        <div className="mb-6">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400 text-xs font-medium mb-3">
                                <Rocket className="w-3 h-3" />
                                Deployment Guide
                            </div>
                            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-3">
                                Mailman 部署指南
                            </h1>
                            <p className="text-base text-gray-600 dark:text-gray-400 leading-relaxed">
                                涵盖从 Docker 一键部署到 Kubernetes 集群的各种部署方式。选择最适合你的方案，快速上线 Mailman 邮件管理系统。
                            </p>
                        </div>

                        {/* 部署方式选择 */}
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 my-6">
                            <DeployMethodCard title="Docker All-in-One" audience="新手、快速体验" complexity={1} time="2 分钟" recommended icon={Container} onClick={() => scrollTo('deploy-docker')} />
                            <DeployMethodCard title="Docker Compose" audience="运维人员、生产环境" complexity={2} time="5 分钟" icon={Layers} onClick={() => scrollTo('deploy-compose')} />
                            <DeployMethodCard title="K3s 轻量集群" audience="边缘计算、IoT" complexity={2} time="5 分钟" icon={CloudCog} onClick={() => scrollTo('deploy-k3s')} />
                            <DeployMethodCard title="Helm / K8s" audience="大规模生产环境" complexity={3} time="10 分钟" icon={Network} onClick={() => scrollTo('deploy-helm')} />
                            <DeployMethodCard title="本地构建镜像" audience="离线部署、自定义" complexity={2} time="10 分钟" icon={Box} onClick={() => scrollTo('deploy-build')} />
                            <DeployMethodCard title="源码开发" audience="开发者" complexity={4} time="15 分钟" icon={Terminal} onClick={() => scrollTo('deploy-source')} />
                        </div>

                        {/* 系统要求 */}
                        <div className="my-4 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 dark:bg-gray-800/80">
                                        <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">资源</th>
                                        <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">最低要求</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                    <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30"><td className="px-4 py-2.5"><span className="flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5 text-blue-500" />CPU</span></td><td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">1 核</td></tr>
                                    <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30"><td className="px-4 py-2.5"><span className="flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5 text-emerald-500" />内存</span></td><td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">1 GB</td></tr>
                                    <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30"><td className="px-4 py-2.5"><span className="flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5 text-amber-500" />磁盘</span></td><td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">5 GB</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* ===== Makefile 快捷命令 ===== */}
                    <section data-section="deploy-makefile">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-gray-600 to-gray-800 text-white shadow-sm">
                                <Terminal className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Makefile 快捷命令</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                项目提供了 Makefile 来简化常用操作。以下是根目录和后端目录的可用命令。
                            </p>

                            {/* 根目录 Makefile */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                <Terminal className="w-4 h-4 text-blue-500" /> 根目录 Makefile (常用命令)
                            </h4>
                            <div className="my-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-gray-800/80">
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">命令</th>
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">说明</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {[
                                            ['make dev', '构建前端 + 启动后端本地开发'],
                                            ['make compose-up', '启动生产环境 (PostgreSQL + All-in-One)'],
                                            ['make compose-down', '停止生产环境'],
                                            ['make compose-logs', '查看生产环境日志'],
                                            ['make compose-build', '重新构建并启动生产环境'],
                                            ['make dev-docker', '启动开发环境 (MySQL + 前后端分离)'],
                                            ['make dev-docker-down', '停止开发环境'],
                                            ['make build-all', '构建 All-in-One Docker 镜像'],
                                            ['make run-all', '运行 All-in-One 镜像'],
                                            ['make clean', '清理所有容器、镜像、构建产物'],
                                            ['make db-shell', '进入 PostgreSQL 命令行'],
                                            ['make backend-shell', '进入容器 Shell'],
                                        ].map(([cmd, desc]) => (
                                            <tr key={cmd} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                                <td className="px-4 py-2.5"><code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200">{cmd}</code></td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{desc}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <CollapsibleCode
                                title="使用示例"
                                defaultOpen={true}
                                code={`# 本地开发（构建前端 + 启动后端）
make dev

# 生产环境一键启动 (PostgreSQL + All-in-One)
make compose-up

# 查看生产环境日志
make compose-logs

# 停止并清理所有环境
make clean`}
                            />

                            {/* 后端 Makefile */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mt-6">
                                <Code2 className="w-4 h-4 text-emerald-500" /> 后端 Makefile (backend/Makefile)
                            </h4>
                            <div className="my-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-gray-800/80">
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">命令</th>
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">说明</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {[
                                            ['make build', '编译所有二进制文件'],
                                            ['make dev', '带竞态检测的开发构建'],
                                            ['make test', '运行所有测试'],
                                            ['make reset-password', '构建密码重置工具'],
                                            ['make clean', '清理构建产物'],
                                            ['make deps', '下载依赖 (go mod tidy + download)'],
                                        ].map(([cmd, desc]) => (
                                            <tr key={cmd} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                                <td className="px-4 py-2.5"><code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200">{cmd}</code></td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{desc}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    {/* ===== Docker All-in-One ===== */}
                    <section data-section="deploy-docker">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-sm">
                                <Container className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Docker All-in-One 一键部署</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                最简单的部署方式，所有服务打包在一个 Docker 镜像中。只需安装 <a href="https://docs.docker.com/get-docker/" target="_blank" rel="noopener" className="text-blue-500 hover:underline">Docker</a> 即可。
                            </p>

                            <CollapsibleCode
                                title="一键部署"
                                defaultOpen={true}
                                code={`docker run -d \\
  --name mailman \\
  -p 8080:8080 \\
  -v mailman_data:/app/data \\
  --restart unless-stopped \\
  ghcr.io/seongminhwan/mailman-all:latest`}
                            />

                            <Callout type="info">
                                部署完成后访问 <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">http://localhost:8080</code>。
                                首次登录时输入您想使用的用户名和密码，系统将自动创建管理员账户。
                            </Callout>

                            <ArchitectureDiagram type="all-in-one" />

                            {/* 多架构支持 */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">多架构支持</h4>
                            <div className="my-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-gray-800/80">
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">架构</th>
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">平台</th>
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">说明</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                            <td className="px-4 py-2.5"><code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">linux/amd64</code></td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">Intel/AMD 64-bit</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">台式机、服务器</td>
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                            <td className="px-4 py-2.5"><code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">linux/arm64</code></td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">ARM 64-bit</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">Apple Silicon (M1/M2/M3)、ARM 服务器</td>
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                            <td className="px-4 py-2.5"><code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">linux/arm/v7</code></td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">ARM 32-bit</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">树莓派、ARM 设备</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <CollapsibleCode
                                title="树莓派部署"
                                code={`docker run -d \\
  --name mailman \\
  -p 8080:8080 \\
  -v mailman_data:/app/data \\
  --platform linux/arm/v7 \\
  ghcr.io/seongminhwan/mailman-all:latest`}
                            />

                            <CollapsibleCode
                                title="容器管理命令"
                                code={`# 查看状态
docker ps

# 查看日志
docker logs -f mailman

# 重启 / 停止 / 启动
docker restart mailman
docker stop mailman
docker start mailman

# 更新到最新版本
docker stop mailman && docker rm mailman
docker pull ghcr.io/seongminhwan/mailman-all:latest
docker run -d \\
  --name mailman \\
  -p 8080:8080 \\
  -v mailman_data:/app/data \\
  --restart unless-stopped \\
  ghcr.io/seongminhwan/mailman-all:latest`}
                            />

                            <CollapsibleCode
                                title="数据备份与恢复"
                                code={`# 备份数据
docker run --rm \\
  -v mailman_data:/data \\
  -v $(pwd):/backup \\
  alpine tar czf /backup/mailman-backup-$(date +%Y%m%d).tar.gz /data

# 恢复数据
docker run --rm \\
  -v mailman_data:/data \\
  -v $(pwd):/backup \\
  alpine tar xzf /backup/mailman-backup-YYYYMMDD.tar.gz -C /`}
                            />
                        </div>
                    </section>

                    {/* ===== Docker Compose ===== */}
                    <section data-section="deploy-compose">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-sm">
                                <Layers className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Docker Compose 部署</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            {/* 生产环境 */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                <Shield className="w-4 h-4 text-emerald-500" /> 生产环境
                            </h4>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                适合使用 PostgreSQL 数据库的生产环境，使用 All-in-One 镜像 + PostgreSQL 组合。
                            </p>

                            <CollapsibleCode
                                title="生产环境部署步骤"
                                defaultOpen={true}
                                code={`# 1. 克隆项目
git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 2. 配置环境变量
cat > .env << 'EOF'
POSTGRES_DB=mailman
POSTGRES_USER=mailman
POSTGRES_PASSWORD=your_password_here
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
EOF

# 3. 启动服务
docker-compose up -d

# 4. 查看状态
docker-compose ps`}
                            />

                            <ArchitectureDiagram type="compose" />

                            <CollapsibleCode
                                title="管理命令"
                                code={`docker-compose logs -f          # 查看日志
docker-compose restart           # 重启服务
docker-compose down              # 停止服务
docker-compose down -v           # 停止并删除数据（慎用）
docker-compose pull && docker-compose up -d  # 更新`}
                            />

                            {/* 开发环境 */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2 mt-6">
                                <Code2 className="w-4 h-4 text-blue-500" /> 开发环境
                            </h4>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                支持代码热重载，适合开发调试。开发环境使用 MySQL 8.0 数据库。
                            </p>

                            <CollapsibleCode
                                title="开发环境启动"
                                code={`# 使用开发配置启动
docker-compose -f docker-compose.dev.yml up -d

# 访问地址：
# 前端界面：http://localhost:3000
# 后端 API：http://localhost:8080
# 数据库：localhost:3307`}
                            />

                            <Callout type="tip">
                                开发模式下，修改 <code className="font-mono text-xs">frontend/</code> 代码会自动重载，修改 <code className="font-mono text-xs">backend/</code> 代码会自动重新编译。
                            </Callout>

                            <Callout type="info">
                                <strong>数据库差异：</strong>生产环境 (<code className="font-mono text-xs">docker-compose.yml</code>) 使用 PostgreSQL 16，
                                开发环境 (<code className="font-mono text-xs">docker-compose.dev.yml</code>) 使用 MySQL 8.0。请注意两者的环境变量配置不同。
                            </Callout>
                        </div>
                    </section>

                    {/* ===== 本地构建镜像 ===== */}
                    <section data-section="deploy-build">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 text-white shadow-sm">
                                <Box className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">本地构建 Docker 镜像</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                适合需要自定义镜像、离线部署或私有镜像仓库的场景。
                            </p>

                            <CollapsibleCode
                                title="构建一体化镜像"
                                defaultOpen={true}
                                code={`git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 构建
docker build -t mailman-all:local -f Dockerfile.all .

# 运行
docker run -d \\
  --name mailman \\
  -p 8080:8080 \\
  -v mailman_data:/app/data \\
  --restart unless-stopped \\
  mailman-all:local`}
                            />

                            <CollapsibleCode
                                title="分别构建前后端"
                                code={`# 构建后端
docker build -t mailman-backend:local -f backend/Dockerfile backend/

# 构建前端（含 Nginx）
docker build -t mailman-frontend:local -f frontend/Dockerfile.nginx frontend/

# 创建网络并运行
docker network create mailman-network

docker run -d \\
  --name mailman-backend \\
  --network mailman-network \\
  -p 8080:8080 \\
  -v mailman_data:/app/data \\
  -e DB_DRIVER=sqlite \\
  -e DB_NAME=/app/data/mailman.db \\
  mailman-backend:local

docker run -d \\
  --name mailman-frontend \\
  --network mailman-network \\
  -p 80:80 \\
  mailman-frontend:local`}
                            />

                            <CollapsibleCode
                                title="多架构构建 & 离线部署"
                                code={`# 多架构构建
docker buildx create --name multiarch-builder --use
docker buildx inspect --bootstrap
docker buildx build \\
  --platform linux/amd64,linux/arm64 \\
  -t your-registry.com/mailman-all:latest \\
  -f Dockerfile.all \\
  --push .

# 离线部署 - 导出
docker save mailman-all:local -o mailman-all.tar

# 离线部署 - 导入
docker load -i mailman-all.tar`}
                            />

                            {/* Dockerfile 说明表格 */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Dockerfile 说明</h4>
                            <div className="my-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-gray-800/80">
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">文件</th>
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">用途</th>
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">端口</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {[
                                            ['Dockerfile.all', '一体化镜像（前端+后端+Nginx）', '80'],
                                            ['backend/Dockerfile', '后端 API 服务', '8080'],
                                            ['frontend/Dockerfile.nginx', '前端（Next.js + Nginx）', '80'],
                                            ['frontend/Dockerfile', '前端（纯 Next.js）', '3000'],
                                            ['backend/Dockerfile.dev', '后端开发模式（热重载）', '8080'],
                                            ['frontend/Dockerfile.dev', '前端开发模式（热重载）', '3000'],
                                        ].map(([file, desc, port]) => (
                                            <tr key={file} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                                <td className="px-4 py-2.5"><code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200">{file}</code></td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{desc}</td>
                                                <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{port}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    {/* ===== K3s 部署 ===== */}
                    <section data-section="deploy-k3s">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-sm">
                                <CloudCog className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">K3s 轻量级集群部署</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                K3s 是轻量级 Kubernetes，适合边缘计算、IoT 和开发环境。
                            </p>

                            <CollapsibleCode
                                title="安装 K3s 和 Helm"
                                defaultOpen={true}
                                code={`# 安装 K3s
curl -sfL https://get.k3s.io | sh -

# 配置 kubectl
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config

# 安装 Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# 验证
kubectl get nodes
helm version`}
                            />

                            <CollapsibleCode
                                title="一键部署脚本"
                                code={`./deploy-k3s.sh
# 脚本自动显示访问地址`}
                            />

                            <CollapsibleCode
                                title="手动部署步骤"
                                code={`# 1. 部署 MariaDB 数据库
kubectl apply -f ./helm/mailman/matrixdb-deployment.yaml
kubectl wait --for=condition=ready pod -l app=mariadb --timeout=300s

# 2. 部署应用
helm install mailman ./helm/mailman \\
  --namespace default \\
  --values ./helm/mailman/values-matrixdb-production.yaml \\
  --values ./helm/mailman/values-k3s.yaml

# 3. 等待就绪
kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=mailman --timeout=300s`}
                            />

                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">访问方式</h4>

                            <CollapsibleCode
                                title="方式 1：NodePort（最简单）"
                                code={`kubectl patch svc mailman-frontend -p '{"spec":{"type":"NodePort"}}'
PORT=$(kubectl get svc mailman-frontend -o jsonpath='{.spec.ports[0].nodePort}')
echo "访问地址: http://localhost:$PORT"`}
                            />

                            <CollapsibleCode
                                title="方式 2：Traefik Ingress（推荐）"
                                language="yaml"
                                code={`cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mailman-ingress
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  rules:
  - host: mailman.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: mailman-frontend
            port:
              number: 80
EOF

echo "127.0.0.1 mailman.local" | sudo tee -a /etc/hosts`}
                            />

                            <CollapsibleCode
                                title="方式 3：端口转发（调试）"
                                code={`kubectl port-forward svc/mailman-frontend 8080:80
# 访问 http://localhost:8080`}
                            />

                            <CollapsibleCode
                                title="K3s 常用操作"
                                code={`# 查看所有资源
kubectl get all -l app.kubernetes.io/name=mailman

# 日志
kubectl logs -f deployment/mailman-backend
kubectl logs -f deployment/mailman-frontend

# 重启
kubectl rollout restart deployment/mailman-backend
kubectl rollout restart deployment/mailman-frontend

# 更新
helm upgrade mailman ./helm/mailman \\
  --values ./helm/mailman/values-matrixdb-production.yaml \\
  --values ./helm/mailman/values-k3s.yaml

# 回滚
helm rollback mailman

# 卸载
helm uninstall mailman
kubectl delete -f ./helm/mailman/matrixdb-deployment.yaml`}
                            />
                        </div>
                    </section>

                    {/* ===== Helm Chart ===== */}
                    <section data-section="deploy-helm">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-sm">
                                <Network className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Helm Chart 部署</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                适合标准 Kubernetes 集群的生产环境部署。要求 Kubernetes 1.24+ 和 Helm 3.8+。
                            </p>

                            <CollapsibleCode
                                title="Helm 部署步骤"
                                defaultOpen={true}
                                code={`# 1. 部署 MariaDB
kubectl apply -f ./helm/mailman/matrixdb-deployment.yaml

# 2. 部署应用
helm install mailman ./helm/mailman \\
  --namespace default \\
  --values ./helm/mailman/values-matrixdb-production.yaml

# 3. 验证
kubectl get pods -l app.kubernetes.io/name=mailman
kubectl get services`}
                            />

                            {/* 服务信息 */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">服务信息</h4>
                            <div className="my-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-gray-800/80">
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">服务</th>
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">类型</th>
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">端口</th>
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">访问</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                            <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium">mailman-frontend</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">ClusterIP</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">80</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">通过 Ingress</td>
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                            <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium">mailman-backend</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">ClusterIP</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">8080</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">仅内部</td>
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                            <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium">mariadb</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">ClusterIP</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">3306</td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">仅内部</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <CollapsibleCode
                                title="生产环境 Ingress + TLS"
                                language="yaml"
                                code={`cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mailman-ingress
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - mailman.yourdomain.com
    secretName: mailman-tls
  rules:
  - host: mailman.yourdomain.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: mailman-frontend
            port:
              number: 80
EOF`}
                            />

                            <CollapsibleCode
                                title="Helm 管理命令"
                                code={`# 更新
helm upgrade mailman ./helm/mailman \\
  --values ./helm/mailman/values-matrixdb-production.yaml

# 查看历史
helm history mailman

# 回滚
helm rollback mailman

# 卸载
helm uninstall mailman
kubectl delete -f ./helm/mailman/matrixdb-deployment.yaml`}
                            />

                            {/* 配置文件说明 */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Values 配置文件</h4>
                            <div className="my-3 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-gray-800/80">
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">文件</th>
                                            <th className="text-left px-4 py-2.5 font-semibold text-gray-700 dark:text-gray-300">用途</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                            <td className="px-4 py-2.5"><code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">values-matrixdb-production.yaml</code></td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">生产环境完整配置</td>
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                            <td className="px-4 py-2.5"><code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">values-k3s.yaml</code></td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">K3s 优化配置（低资源）</td>
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                                            <td className="px-4 py-2.5"><code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">values-local-test.yaml</code></td>
                                            <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">本地测试最小配置</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    {/* ===== 源码开发 ===== */}
                    <section data-section="deploy-source">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-sm">
                                <Terminal className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">源码开发环境</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                适合开发者进行调试和二次开发。需要 Go 1.23+、Node.js 18+。
                            </p>

                            <CollapsibleCode
                                title="完整安装步骤"
                                defaultOpen={true}
                                code={`# 1. 克隆项目
git clone https://github.com/seongminhwan/mailman.git
cd mailman

# 2. 配置并启动后端
cd backend
cat > .env << 'EOF'
DB_DRIVER=sqlite
DB_NAME=./mailman.db
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
LOG_LEVEL=DEBUG
EOF

go mod download
go run cmd/mailman/main.go

# 3. 配置并启动前端（新终端）
cd frontend
cat > .env.local << 'EOF'
NEXT_PUBLIC_API_URL=http://localhost:8080
EOF

npm install
npm run dev`}
                            />

                            <CollapsibleCode
                                title="使用 Makefile (推荐)"
                                code={`cd backend
make deps   # 下载依赖
make dev    # 带竞态检测的开发构建并运行`}
                            />

                            <div className="p-4 rounded-xl bg-gradient-to-r from-gray-50 to-emerald-50 dark:from-gray-800/50 dark:to-emerald-900/20 border border-gray-200 dark:border-gray-700">
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">访问地址</p>
                                <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                                    <li className="flex items-center gap-2"><Monitor className="w-3.5 h-3.5 text-purple-500" /> 前端界面：<code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">http://localhost:3000</code></li>
                                    <li className="flex items-center gap-2"><Server className="w-3.5 h-3.5 text-blue-500" /> 后端 API：<code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">http://localhost:8080</code></li>
                                    <li className="flex items-center gap-2"><FileText className="w-3.5 h-3.5 text-amber-500" /> API 文档：<code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">/swagger/index.html</code></li>
                                </ul>
                            </div>

                            <CollapsibleCode
                                title="密码重置"
                                code={`cd backend
make reset-password
./reset-password -username=admin -password=new_password -force`}
                            />
                        </div>
                    </section>

                    {/* ===== 环境变量 ===== */}
                    <section data-section="deploy-env">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-gray-600 to-gray-800 text-white shadow-sm">
                                <Settings className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">环境变量说明</h3>
                        </div>

                        <div className="pl-12 space-y-4">
                            {/* 服务器配置 */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                <Server className="w-4 h-4 text-blue-500" /> 服务器配置
                            </h4>
                            <FieldTable fields={[
                                { name: 'SERVER_HOST', type: 'string', desc: '监听地址，默认 localhost' },
                                { name: 'SERVER_PORT', type: 'string', desc: '监听端口，默认 8080' },
                                { name: 'LOG_LEVEL', type: 'string', desc: '日志级别：DEBUG / INFO / WARN / ERROR' },
                                { name: 'LOG_QUIET_PREFIXES', type: 'string', desc: '静默日志前缀，如 FetcherService,AccountSyncer' },
                            ]} />

                            {/* 数据库配置 */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                <Database className="w-4 h-4 text-emerald-500" /> 数据库配置
                            </h4>
                            <FieldTable fields={[
                                { name: 'DB_DRIVER', type: 'string', desc: '数据库驱动：sqlite / mysql / postgres' },
                                { name: 'DB_NAME', type: 'string', desc: '数据库名或文件路径，默认 mailman.db' },
                                { name: 'DB_HOST', type: 'string', desc: '数据库主机，默认 localhost' },
                                { name: 'DB_PORT', type: 'string', desc: '数据库端口，MySQL:3306 / PG:5432' },
                                { name: 'DB_USER', type: 'string', desc: '数据库用户，默认 mailman' },
                                { name: 'DB_PASSWORD', type: 'string', desc: '数据库密码' },
                                { name: 'DB_SSLMODE', type: 'string', desc: 'SSL 模式，默认 disable' },
                            ]} />

                            {/* OAuth2 & 前端 */}
                            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                <Lock className="w-4 h-4 text-purple-500" /> OAuth2 & 前端
                            </h4>
                            <FieldTable fields={[
                                { name: 'GMAIL_REDIRECT_URI', type: 'string', desc: 'Gmail OAuth2 回调地址' },
                                { name: 'OUTLOOK_REDIRECT_URI', type: 'string', desc: 'Outlook OAuth2 回调地址' },
                                { name: 'ENCRYPTION_KEY', type: 'string', desc: '敏感数据加密密钥（base64 编码的 32 字节）' },
                                { name: 'NEXT_PUBLIC_API_URL', type: 'string', desc: '前端连接的后端 API 地址' },
                            ]} />

                            <Callout type="info">
                                OAuth2 的 Client ID 和 Client Secret 通过 Web 界面的「设置 → OAuth2 配置」进行配置，无需在环境变量中设置。
                            </Callout>
                        </div>
                    </section>

                    {/* ===== 故障排查 ===== */}
                    <section data-section="deploy-troubleshoot">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-sm">
                                <Wrench className="w-4 h-4" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">故障排查</h3>
                        </div>

                        <div className="pl-12 space-y-3">
                            {[
                                {
                                    q: '端口被占用',
                                    a: '使用 lsof -i :8080 检查占用进程，kill -9 <PID> 终止，或改用其他端口：docker run -p 9000:8080 ...',
                                },
                                {
                                    q: '容器无法启动',
                                    a: '执行 docker logs mailman 查看日志，如有问题可 docker rm -f mailman 后重新运行。',
                                },
                                {
                                    q: '无法连接数据库',
                                    a: 'SQLite：确保数据库文件路径可写 (ls -la ./mailman.db)。MySQL：使用 mysql 命令测试连接。',
                                },
                                {
                                    q: 'API 连接失败',
                                    a: '检查后端健康：curl http://localhost:8080/health。确认 NEXT_PUBLIC_API_URL 配置正确。',
                                },
                                {
                                    q: '前端页面空白',
                                    a: '运行 npm run build 检查前端构建，确保 next.config.js 中的 rewrites 配置正确。',
                                },
                                {
                                    q: 'K3s Pod 无法调度',
                                    a: '清除 master 污点：kubectl taint nodes --all node-role.kubernetes.io/master-',
                                },
                                {
                                    q: '镜像下载失败',
                                    a: '检查网络连接，或使用离线镜像方案：docker save / docker load。',
                                },
                                {
                                    q: '性能问题',
                                    a: '使用 docker stats 检查资源使用，df -h 检查磁盘空间，docker system prune -a 清理无用资源。',
                                },
                            ].map((faq, idx) => (
                                <FAQItem key={`deploy-faq-${idx}`} question={faq.q} answer={faq.a} />
                            ))}
                        </div>
                    </section>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="mt-8 grid gap-3 border-t border-gray-200 pt-6 dark:border-gray-800 sm:grid-cols-2">
                        <button
                            type="button"
                            disabled={!previousSection}
                            onClick={() => previousSection && scrollTo(previousSection.id)}
                            className={cn(
                                'flex min-h-[76px] items-center gap-3 rounded-2xl border p-4 text-left transition-all duration-200',
                                previousSection
                                    ? 'border-gray-200 bg-white hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'
                                    : 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-50 dark:border-gray-900 dark:bg-gray-950'
                            )}
                        >
                            <ChevronRight className="h-4 w-4 rotate-180 text-gray-400" />
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">上一节</div>
                                <div className="mt-1 text-sm font-semibold text-gray-800 dark:text-gray-200">
                                    {previousSection?.label || '已经是开头'}
                                </div>
                            </div>
                        </button>
                        <button
                            type="button"
                            disabled={!nextSection}
                            onClick={() => nextSection && scrollTo(nextSection.id)}
                            className={cn(
                                'flex min-h-[76px] items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-all duration-200',
                                nextSection
                                    ? 'border-gray-200 bg-white hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700'
                                    : 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-50 dark:border-gray-900 dark:bg-gray-950'
                            )}
                        >
                            <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">下一节</div>
                                <div className="mt-1 text-sm font-semibold text-gray-800 dark:text-gray-200">
                                    {nextSection?.label || '已经读完'}
                                </div>
                            </div>
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                        </button>
                    </div>

                    {/* 底部间距 */}
                    <div className="h-20" />
                </div>
            </div>
        </div>
    )
}

// FAQ 折叠项
function FAQItem({ question, answer }: { question: string; answer: string }) {
    const [open, setOpen] = useState(false)

    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="flex items-center justify-between w-full px-4 py-3 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
            >
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Q: {question}</span>
                <ChevronDown className={cn(
                    'w-4 h-4 text-gray-400 transition-transform duration-200 flex-shrink-0 ml-2',
                    open && 'rotate-180'
                )} />
            </button>
            <div className={cn(
                'overflow-hidden transition-all duration-300',
                open ? 'max-h-40' : 'max-h-0'
            )}>
                <div className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800">
                    <strong>A:</strong> {answer}
                </div>
            </div>
        </div>
    )
}
