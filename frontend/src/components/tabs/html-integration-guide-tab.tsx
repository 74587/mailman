'use client'

import { useMemo, useState } from 'react'
import {
    BookOpen,
    ExternalLink,
    FileText,
    Rocket,
    KeyRound,
    RefreshCw,
    Package,
    Zap,
    Shield,
    Bot,
    Code2,
    Wrench,
    Search,
    PanelLeftClose,
    PanelLeftOpen,
    Briefcase,
    Network,
    type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type DocCategory = '入门' | '邮箱运营' | '自动化' | '高级能力' | 'API 与运维'

interface HtmlGuideDoc {
    id: string
    title: string
    description: string
    href: string
    category: DocCategory
    icon: LucideIcon
    tags: string[]
}

const HTML_GUIDE_DOCS: HtmlGuideDoc[] = [
    {
        id: 'index',
        title: '文档中心',
        description: '总览 Mailman 的学习路径、HTML 文档列表、接口地图和源码依据。',
        href: '/guide-html/index.html',
        category: '入门',
        icon: BookOpen,
        tags: ['总览', '路径', '接口地图'],
    },
    {
        id: 'quick-start',
        title: '从 0 到 1 快速上手',
        description: '首次启动、登录、主流程、菜单地图和下一步路径。',
        href: '/guide-html/quick-start.html',
        category: '入门',
        icon: Rocket,
        tags: ['首次登录', '菜单', '工作流'],
    },
    {
        id: 'accounts-oauth',
        title: '邮箱账户与 OAuth2',
        description: 'Gmail、Outlook、IMAP/SMTP、账户验证、转发落件地址和错误状态。',
        href: '/guide-html/accounts-oauth.html',
        category: '邮箱运营',
        icon: KeyRound,
        tags: ['OAuth2', '账户', '验证'],
    },
    {
        id: 'sync-mailbox',
        title: '同步、邮件管理与搜索',
        description: '全局同步、账户同步、临时同步、邮件搜索、详情、附件和监控。',
        href: '/guide-html/sync-mailbox.html',
        category: '邮箱运营',
        icon: RefreshCw,
        tags: ['同步', '搜索', '附件'],
    },
    {
        id: 'pickup-extractor',
        title: '取件与取件模板 V2',
        description: '统一取件轮询、验证码等待、取件模板结构、动作链和输出格式。',
        href: '/guide-html/pickup-extractor.html',
        category: '邮箱运营',
        icon: Package,
        tags: ['取件', '验证码', '模板 V2'],
    },
    {
        id: 'triggers-actions',
        title: '触发器、表达式与动作插件',
        description: 'EmailTriggerV2、表达式类型、内置条件插件、动作插件和日志。',
        href: '/guide-html/triggers-actions.html',
        category: '自动化',
        icon: Zap,
        tags: ['触发器', '插件', '动作链'],
    },
    {
        id: 'interceptors-templates',
        title: '拦截器与模板复用',
        description: 'before/after 拦截器、过滤策略、错误策略、过滤器模板和动作模板。',
        href: '/guide-html/interceptors-templates.html',
        category: '自动化',
        icon: Shield,
        tags: ['拦截器', '模板', '治理'],
    },
    {
        id: 'business-account-automation',
        title: '基于业务账户的自动化教程',
        description: '领取邮箱、预热取件、验证码提取、完成注册和回写业务资料。',
        href: '/guide-html/business-account-automation.html',
        category: '自动化',
        icon: Briefcase,
        tags: ['领取邮箱', '验证码', '业务账户'],
    },
    {
        id: 'ai-business-proxy',
        title: 'AI、业务资料、标签与代理池',
        description: 'AI 配置、Prompt 模板、业务账户、标签组、代理池和组合玩法。',
        href: '/guide-html/ai-business-proxy.html',
        category: '高级能力',
        icon: Bot,
        tags: ['AI', '业务账户', '代理池'],
    },
    {
        id: 'proxy-pool-management',
        title: '代理池管理与代理网关接入',
        description: '上游代理、HTTP/SOCKS5 网关、安全策略、DNS 策略、网关用户和接入示例。',
        href: '/guide-html/proxy-pool-management.html',
        category: '高级能力',
        icon: Network,
        tags: ['代理网关', 'SOCKS5', '安全策略'],
    },
    {
        id: 'api-reference',
        title: 'API 接入总览',
        description: '登录、领域接口、WebSocket、权限资源和接入约定。',
        href: '/guide-html/api-reference.html',
        category: 'API 与运维',
        icon: Code2,
        tags: ['API', '权限', 'WebSocket'],
    },
    {
        id: 'recipes-troubleshooting',
        title: '组合场景与故障排查',
        description: '验证码取件、转发通知、AI 分类、业务账号恢复和上线检查清单。',
        href: '/guide-html/recipes-troubleshooting.html',
        category: '高级能力',
        icon: Wrench,
        tags: ['配方', '排错', '上线检查'],
    },
    {
        id: 'deployment-ops',
        title: '部署与生产运维',
        description: 'Docker、Compose、K3s、Helm、环境变量、备份升级和监控。',
        href: '/guide-html/deployment-ops.html',
        category: 'API 与运维',
        icon: Rocket,
        tags: ['部署', '运维', '备份'],
    },
]

const CATEGORIES: Array<'全部' | DocCategory> = ['全部', '入门', '邮箱运营', '自动化', '高级能力', 'API 与运维']

export default function HtmlIntegrationGuideTab() {
    const [activeDocId, setActiveDocId] = useState('index')
    const [category, setCategory] = useState<'全部' | DocCategory>('全部')
    const [query, setQuery] = useState('')
    const [navCollapsed, setNavCollapsed] = useState(false)

    const activeDoc = HTML_GUIDE_DOCS.find(doc => doc.id === activeDocId) || HTML_GUIDE_DOCS[0]
    const normalizedQuery = query.trim().toLowerCase()

    const filteredDocs = useMemo(() => {
        return HTML_GUIDE_DOCS.filter(doc => {
            const categoryMatch = category === '全部' || doc.category === category
            if (!categoryMatch) return false
            if (!normalizedQuery) return true
            const haystack = [
                doc.title,
                doc.description,
                doc.category,
                ...doc.tags,
            ].join(' ').toLowerCase()
            return haystack.includes(normalizedQuery)
        })
    }, [category, normalizedQuery])

    return (
        <div className="flex h-full bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
            <aside className={cn(
                'flex shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900',
                navCollapsed ? 'w-16' : 'w-[340px]'
            )}>
                <div className="border-b border-slate-200 p-3 dark:border-slate-800">
                    <div className={cn('flex items-center gap-3', navCollapsed && 'justify-center')}>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white dark:bg-white dark:text-slate-950">
                            <BookOpen className="h-5 w-5" />
                        </div>
                        {!navCollapsed && (
                            <div className="min-w-0 flex-1">
                                <h2 className="text-sm font-bold text-slate-950 dark:text-white">接入手册</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400">HTML Guide Library</p>
                            </div>
                        )}
                        <button
                            type="button"
                            onClick={() => setNavCollapsed(value => !value)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-white"
                            title={navCollapsed ? '展开文档列表' : '折叠文档列表'}
                        >
                            {navCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                        </button>
                    </div>

                    {!navCollapsed && (
                        <label className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                            <Search className="h-4 w-4 text-slate-400" />
                            <input
                                value={query}
                                onChange={event => setQuery(event.target.value)}
                                placeholder="搜索文档、功能或接口"
                                className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
                            />
                        </label>
                    )}
                </div>

                {!navCollapsed && (
                    <div className="border-b border-slate-200 p-3 dark:border-slate-800">
                        <div className="flex flex-wrap gap-2">
                            {CATEGORIES.map(item => (
                                <button
                                    key={item}
                                    type="button"
                                    onClick={() => setCategory(item)}
                                    className={cn(
                                        'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                                        category === item
                                            ? 'border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950'
                                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-white'
                                    )}
                                >
                                    {item}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className={cn('min-h-0 flex-1 overflow-y-auto', navCollapsed ? 'p-2' : 'p-3')}>
                    {!navCollapsed && (
                        <div className="mb-2 flex items-center justify-between px-1 text-xs text-slate-400">
                            <span>文档</span>
                            <span>{filteredDocs.length}/{HTML_GUIDE_DOCS.length}</span>
                        </div>
                    )}
                    <div className={cn(navCollapsed ? 'space-y-2' : 'space-y-2')}>
                        {(navCollapsed ? HTML_GUIDE_DOCS : filteredDocs).map(doc => (
                            <button
                                key={doc.id}
                                type="button"
                                onClick={() => setActiveDocId(doc.id)}
                                className={cn(
                                    'group w-full border text-left transition-all',
                                    navCollapsed ? 'flex h-11 items-center justify-center rounded-lg p-0' : 'rounded-lg p-3',
                                    activeDoc.id === doc.id
                                        ? 'border-blue-200 bg-blue-50 shadow-sm dark:border-blue-800 dark:bg-blue-950/30'
                                        : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                                )}
                                title={doc.title}
                            >
                                <div className={cn('flex gap-3', navCollapsed && 'justify-center')}>
                                    <div className={cn(
                                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                                        activeDoc.id === doc.id
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-slate-100 text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 dark:bg-slate-800 dark:text-slate-400'
                                    )}>
                                        <doc.icon className="h-4 w-4" />
                                    </div>
                                    {!navCollapsed && (
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <h3 className="truncate text-sm font-bold text-slate-950 dark:text-white">{doc.title}</h3>
                                            </div>
                                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                                {doc.description}
                                            </p>
                                        </div>
                                    )}
                                </div>
                                {!navCollapsed && (
                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                            {doc.category}
                                        </span>
                                        {doc.tags.slice(0, 3).map(tag => (
                                            <span key={tag} className="rounded bg-white px-2 py-0.5 text-[10px] font-medium text-slate-400 ring-1 ring-slate-200 dark:bg-slate-950 dark:ring-slate-800">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </aside>

            <section className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                            <FileText className="h-3.5 w-3.5" />
                            <span>{activeDoc.category}</span>
                        </div>
                        <h1 className="truncate text-lg font-bold text-slate-950 dark:text-white">{activeDoc.title}</h1>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <a
                            href="/swagger/index.html"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:text-blue-600 dark:border-slate-800 dark:text-slate-300 dark:hover:border-blue-800"
                        >
                            Swagger
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        <a
                            href={activeDoc.href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-600 dark:bg-white dark:text-slate-950 dark:hover:bg-blue-200"
                        >
                            新窗口打开
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    </div>
                </div>

                <div className="min-h-0 flex-1 p-3">
                    <div className="h-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <iframe
                            key={activeDoc.href}
                            src={activeDoc.href}
                            title={activeDoc.title}
                            className="h-full w-full border-0 bg-white"
                        />
                    </div>
                </div>
            </section>
        </div>
    )
}
