'use client'

import { useEffect, useState, useRef } from 'react'
import {
    Settings, Save, RotateCcw, AlertCircle, Search,
    Sun, Moon, Monitor, LayoutGrid, Keyboard, Sliders,
    ChevronRight, Check, LogIn, Sparkles, Palette, Smile
} from 'lucide-react'
import { toast } from 'sonner'
import { systemConfigService, SystemConfig } from '@/services/system-config.service'
import { KeyboardShortcutsSettings } from '@/components/settings/keyboard-shortcuts-settings'
import { MenuVisibilitySettings } from '@/components/settings/menu-visibility-settings'
import { useTheme } from '@/components/theme-provider'
import { cn } from '@/lib/utils'
import { useConfirmDialog } from '@/hooks/use-confirm-dialog'
import { useAuth } from '@/context/auth-context'

// 设置分区定义
const sections = [
    { id: 'appearance', name: '外观', icon: Sun, description: '主题与显示偏好' },
    { id: 'menu', name: '菜单管理', icon: LayoutGrid, description: '侧边栏菜单配置' },
    { id: 'shortcuts', name: '快捷键', icon: Keyboard, description: '键盘快捷键设置' },
    { id: 'configs', name: '高级配置', icon: Sliders, description: '系统参数调整' },
] as const

type SectionId = typeof sections[number]['id']

export default function SystemConfigTab() {
    const { confirm } = useConfirmDialog()
    const { theme, setTheme } = useTheme()
    const [activeSection, setActiveSection] = useState<SectionId>('appearance')
    const [configs, setConfigs] = useState<SystemConfig[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [modifiedConfigs, setModifiedConfigs] = useState<Record<string, any>>({})

    useEffect(() => {
        loadConfigs()
    }, [])

    const loadConfigs = async () => {
        try {
            setLoading(true)
            const data = await systemConfigService.getAllConfigs()
            setConfigs(data)
        } catch (error) {
            console.error('Failed to load system configs:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleConfigChange = (key: string, value: any) => {
        setModifiedConfigs(prev => ({ ...prev, [key]: value }))
    }

    const handleSaveConfig = async (config: SystemConfig) => {
        const modifiedValue = modifiedConfigs[config.key]
        if (modifiedValue === undefined) return

        const validation = systemConfigService.validateConfigValue(config, modifiedValue)
        if (!validation.valid) {
            toast.error(`配置值无效: ${validation.error}`)
            return
        }

        try {
            setSaving(config.key)
            await systemConfigService.updateConfigValue(config.key, modifiedValue)
            setConfigs(prev => prev.map(c =>
                c.key === config.key ? { ...c, current_value: modifiedValue } : c
            ))
            setModifiedConfigs(prev => {
                const n = { ...prev }
                delete n[config.key]
                return n
            })
            toast.success('配置已保存')
        } catch {
            toast.error('保存配置失败')
        } finally {
            setSaving(null)
        }
    }

    const handleResetConfig = async (config: SystemConfig) => {
        const confirmed = await confirm({
            title: '重置配置',
            description: `确定要重置"${config.name}"为默认值吗？`,
            confirmText: '重置',
            cancelText: '取消'
        })
        if (!confirmed) return

        try {
            setSaving(config.key)
            const resetConfig = await systemConfigService.resetConfigToDefault(config.key)
            setConfigs(prev => prev.map(c => c.key === config.key ? resetConfig : c))
            setModifiedConfigs(prev => {
                const n = { ...prev }
                delete n[config.key]
                return n
            })
            toast.success('配置已重置为默认值')
        } catch {
            toast.error('重置配置失败')
        } finally {
            setSaving(null)
        }
    }

    const getCurrentValue = (config: SystemConfig) => {
        return modifiedConfigs[config.key] !== undefined ? modifiedConfigs[config.key] : config.current_value
    }

    const isConfigModified = (config: SystemConfig) => {
        return modifiedConfigs[config.key] !== undefined
    }

    const modifiedCount = Object.keys(modifiedConfigs).length

    // 按分类分组后的配置（仅 visible）
    const visibleConfigs = (configs || []).filter(c => c.is_visible)
    const filteredConfigs = visibleConfigs.filter(c => {
        if (!searchQuery) return true
        const q = searchQuery.toLowerCase()
        return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.key.toLowerCase().includes(q)
    })
    const grouped = systemConfigService.groupConfigsByCategory(filteredConfigs)
    const categoryKeys = Object.keys(grouped).sort()

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center">
                    <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-[3px] border-blue-500 border-t-transparent" />
                    <p className="text-sm text-gray-400">加载配置中...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex gap-6 min-h-[calc(100vh-10rem)]">
            {/* 左侧导航 */}
            <div className="w-56 flex-shrink-0">
                <div className="sticky top-4 space-y-1">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4 px-3 flex items-center gap-2">
                        <Settings className="h-5 w-5 text-blue-500" />
                        系统配置
                    </h1>

                    {sections.map(section => {
                        const Icon = section.icon
                        const isActive = activeSection === section.id
                        return (
                            <button
                                key={section.id}
                                onClick={() => setActiveSection(section.id)}
                                className={cn(
                                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150',
                                    isActive
                                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                                )}
                            >
                                <Icon className={cn('h-4 w-4 flex-shrink-0', isActive ? 'text-blue-500' : '')} />
                                <div className="min-w-0">
                                    <div className={cn('text-sm font-medium truncate', isActive ? 'text-blue-600 dark:text-blue-400' : '')}>
                                        {section.name}
                                    </div>
                                    <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{section.description}</div>
                                </div>
                                {isActive && <ChevronRight className="h-3.5 w-3.5 ml-auto text-blue-400 flex-shrink-0" />}
                            </button>
                        )
                    })}

                    {/* 未保存提示 */}
                    {modifiedCount > 0 && (
                        <div className="mt-4 mx-1 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                <span className="text-xs font-medium">{modifiedCount} 项未保存</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 右侧内容区 */}
            <div className="flex-1 min-w-0">
                {activeSection === 'appearance' && <AppearanceSection theme={theme} setTheme={setTheme} />}
                {activeSection === 'menu' && <MenuVisibilitySettings />}
                {activeSection === 'shortcuts' && <KeyboardShortcutsSettings />}
                {activeSection === 'configs' && (
                    <ConfigsSection
                        configs={filteredConfigs}
                        grouped={grouped}
                        categoryKeys={categoryKeys}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        getCurrentValue={getCurrentValue}
                        isConfigModified={isConfigModified}
                        saving={saving}
                        onSave={handleSaveConfig}
                        onReset={handleResetConfig}
                        onChange={handleConfigChange}
                    />
                )}
            </div>
        </div>
    )
}

/* ─────────────────────────────────────────────────────────────── */
/* 外观设置 Section                                                 */
/* ─────────────────────────────────────────────────────────────── */

function AppearanceSection({ theme, setTheme }: { theme: string; setTheme: (t: any) => void }) {
    const { isSuperAdmin } = useAuth()
    const [loginTheme, setLoginTheme] = useState<string>('classic')
    const [loginThemeLoading, setLoginThemeLoading] = useState(true)
    const [loginThemeSaving, setLoginThemeSaving] = useState(false)

    useEffect(() => {
        if (isSuperAdmin) {
            systemConfigService.getLoginTheme().then(t => {
                setLoginTheme(t)
                setLoginThemeLoading(false)
            })
        }
    }, [isSuperAdmin])

    const handleLoginThemeChange = async (newTheme: string) => {
        setLoginThemeSaving(true)
        try {
            await systemConfigService.setLoginTheme(newTheme)
            setLoginTheme(newTheme)
            toast.success('登录页主题已更新')
        } catch {
            toast.error('更新登录页主题失败')
        } finally {
            setLoginThemeSaving(false)
        }
    }

    const themes = [
        { id: 'light', name: '浅色模式', desc: '适合明亮环境', icon: Sun, preview: 'from-white to-gray-100 border-gray-200' },
        { id: 'dark', name: '深色模式', desc: '减少眼睛疲劳', icon: Moon, preview: 'from-gray-800 to-gray-900 border-gray-700' },
        { id: 'system', name: '跟随系统', desc: '自动匹配系统主题', icon: Monitor, preview: 'from-white to-gray-900 border-gray-300' },
    ]

    const loginThemes = [
        {
            id: 'classic',
            name: '经典',
            desc: '蓝紫渐变 + 粒子效果',
            icon: Palette,
            previewGradient: 'from-blue-100 via-indigo-50 to-purple-100',
            previewBorder: 'border-blue-200',
        },
        {
            id: 'elegant',
            name: '优雅',
            desc: '深空玻璃态 + 3D效果',
            icon: Sparkles,
            previewGradient: 'from-gray-900 via-blue-900 to-purple-900',
            previewBorder: 'border-blue-500/30',
        },
        {
            id: 'playful',
            name: '趣味互动',
            desc: '小玩偶遮眼动画 🙈',
            icon: Smile,
            previewGradient: 'from-yellow-50 via-orange-50 to-purple-50',
            previewBorder: 'border-orange-200',
        },
    ]

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">外观</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">自定义应用的视觉风格</p>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700/50">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">主题</h3>
                    <p className="mt-0.5 text-xs text-gray-400">选择你喜欢的色彩方案</p>
                </div>
                <div className="p-5 grid grid-cols-3 gap-4">
                    {themes.map(t => {
                        const Icon = t.icon
                        const isActive = theme === t.id
                        return (
                            <button
                                key={t.id}
                                onClick={() => setTheme(t.id)}
                                className={cn(
                                    'relative group rounded-xl border-2 p-4 transition-all duration-200 text-left',
                                    isActive
                                        ? 'border-blue-500 bg-blue-500/5 dark:bg-blue-500/10 shadow-sm shadow-blue-500/10'
                                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm'
                                )}
                            >
                                {/* 预览条 */}
                                <div className={cn(
                                    'h-16 rounded-lg bg-gradient-to-br mb-3 border',
                                    t.preview
                                )} />

                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <Icon className={cn(
                                                'h-3.5 w-3.5',
                                                isActive ? 'text-blue-500' : 'text-gray-400'
                                            )} />
                                            <span className={cn(
                                                'text-sm font-medium',
                                                isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
                                            )}>
                                                {t.name}
                                            </span>
                                        </div>
                                        <p className="mt-0.5 text-[11px] text-gray-400">{t.desc}</p>
                                    </div>
                                    {isActive && (
                                        <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                                            <Check className="h-3 w-3 text-white" />
                                        </div>
                                    )}
                                </div>
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* 登录页主题 - 仅超级管理员可见 */}
            {isSuperAdmin && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700/50">
                        <div className="flex items-center gap-2">
                            <LogIn className="h-4 w-4 text-blue-500" />
                            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">登录页主题</h3>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-400">设置系统默认登录页面的视觉风格（仅超级管理员可修改）</p>
                    </div>
                    <div className="p-5 grid grid-cols-3 gap-4">
                        {loginThemeLoading ? (
                            <div className="col-span-3 py-8 flex items-center justify-center">
                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                            </div>
                        ) : (
                            loginThemes.map(lt => {
                                const Icon = lt.icon
                                const isActive = loginTheme === lt.id
                                return (
                                    <button
                                        key={lt.id}
                                        onClick={() => handleLoginThemeChange(lt.id)}
                                        disabled={loginThemeSaving}
                                        className={cn(
                                            'relative group rounded-xl border-2 p-4 transition-all duration-200 text-left disabled:opacity-60',
                                            isActive
                                                ? 'border-blue-500 bg-blue-500/5 dark:bg-blue-500/10 shadow-sm shadow-blue-500/10'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm'
                                        )}
                                    >
                                        {/* 预览条 */}
                                        <div className={cn(
                                            'h-16 rounded-lg bg-gradient-to-br mb-3 border',
                                            lt.previewGradient,
                                            lt.previewBorder
                                        )} />

                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="flex items-center gap-1.5">
                                                    <Icon className={cn(
                                                        'h-3.5 w-3.5',
                                                        isActive ? 'text-blue-500' : 'text-gray-400'
                                                    )} />
                                                    <span className={cn(
                                                        'text-sm font-medium',
                                                        isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
                                                    )}>
                                                        {lt.name}
                                                    </span>
                                                </div>
                                                <p className="mt-0.5 text-[11px] text-gray-400">{lt.desc}</p>
                                            </div>
                                            {isActive && (
                                                <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                                                    <Check className="h-3 w-3 text-white" />
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

/* ─────────────────────────────────────────────────────────────── */
/* 高级配置 Section                                                 */
/* ─────────────────────────────────────────────────────────────── */

interface ConfigsSectionProps {
    configs: SystemConfig[]
    grouped: Record<string, SystemConfig[]>
    categoryKeys: string[]
    searchQuery: string
    setSearchQuery: (q: string) => void
    getCurrentValue: (c: SystemConfig) => any
    isConfigModified: (c: SystemConfig) => boolean
    saving: string | null
    onSave: (c: SystemConfig) => void
    onReset: (c: SystemConfig) => void
    onChange: (key: string, value: any) => void
}

function ConfigsSection({
    configs, grouped, categoryKeys, searchQuery, setSearchQuery,
    getCurrentValue, isConfigModified, saving, onSave, onReset, onChange
}: ConfigsSectionProps) {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">高级配置</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">系统运行参数，修改后需保存生效</p>
                </div>
                {/* 搜索 */}
                <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="搜索配置项..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
                    />
                </div>
            </div>

            {categoryKeys.length > 0 ? (
                <div className="space-y-4">
                    {categoryKeys.map(category => (
                        <div key={category} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 overflow-hidden">
                            {/* 分类头部 */}
                            <div className="px-5 py-3 bg-gray-50/80 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700/50">
                                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                                    {systemConfigService.getCategoryDisplayName(category)}
                                </h3>
                            </div>

                            {/* 配置项列表 */}
                            <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                                {grouped[category].map(config => (
                                    <ConfigRow
                                        key={config.key}
                                        config={config}
                                        currentValue={getCurrentValue(config)}
                                        isModified={isConfigModified(config)}
                                        isSaving={saving === config.key}
                                        onSave={() => onSave(config)}
                                        onReset={() => onReset(config)}
                                        onChange={onChange}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-16">
                    <Search className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
                    <p className="mt-3 text-sm text-gray-400">
                        {searchQuery ? '没有匹配的配置项' : '暂无可用配置项'}
                    </p>
                </div>
            )}
        </div>
    )
}

/* ─────────────────────────────────────────────────────────────── */
/* 单行配置项                                                        */
/* ─────────────────────────────────────────────────────────────── */

interface ConfigRowProps {
    config: SystemConfig
    currentValue: any
    isModified: boolean
    isSaving: boolean
    onSave: () => void
    onReset: () => void
    onChange: (key: string, value: any) => void
}

function ConfigRow({ config, currentValue, isModified, isSaving, onSave, onReset, onChange }: ConfigRowProps) {
    return (
        <div className={cn(
            'px-5 py-4 transition-colors',
            isModified ? 'bg-blue-50/50 dark:bg-blue-500/5' : 'hover:bg-gray-50/50 dark:hover:bg-gray-700/20'
        )}>
            <div className="flex items-start justify-between gap-4">
                {/* 左：信息 */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {config.name}
                        </h4>
                        {!config.is_editable && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-400 font-medium flex-shrink-0">
                                只读
                            </span>
                        )}
                        {isModified && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" title="已修改" />
                        )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 line-clamp-1">{config.description}</p>
                    <div className="mt-1 text-[11px] text-gray-300 dark:text-gray-600 font-mono">{config.key}</div>
                </div>

                {/* 右：控件 + 操作 */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    {/* 输入控件 */}
                    <div className="w-48">
                        <ConfigInput config={config} currentValue={currentValue} onChange={onChange} />
                    </div>

                    {/* 操作按钮 */}
                    {config.is_editable && (
                        <div className="flex items-center gap-1">
                            {isModified && (
                                <button
                                    onClick={onSave}
                                    disabled={isSaving}
                                    className="p-1.5 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
                                    title="保存"
                                >
                                    {isSaving ? (
                                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white border-t-transparent" />
                                    ) : (
                                        <Save className="h-3.5 w-3.5" />
                                    )}
                                </button>
                            )}
                            <button
                                onClick={onReset}
                                disabled={isSaving}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                                title="重置为默认值"
                            >
                                <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

/* ─────────────────────────────────────────────────────────────── */
/* 配置输入控件                                                      */
/* ─────────────────────────────────────────────────────────────── */

function ConfigInput({
    config, currentValue, onChange
}: { config: SystemConfig; currentValue: any; onChange: (key: string, val: any) => void }) {
    const inputClass = 'w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 py-1.5 px-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-50 transition-colors'

    switch (config.value_type) {
        case 'boolean':
            return (
                <div className="flex justify-end">
                    <button
                        onClick={() => config.is_editable && onChange(config.key, !currentValue)}
                        disabled={!config.is_editable}
                        className={cn(
                            'relative w-10 h-[22px] rounded-full transition-colors duration-200 disabled:opacity-50',
                            currentValue ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'
                        )}
                    >
                        <span className={cn(
                            'absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-transform duration-200',
                            currentValue ? 'left-[20px]' : 'left-[2px]'
                        )} />
                    </button>
                </div>
            )

        case 'string':
            return (
                <input
                    type="text"
                    value={currentValue || ''}
                    onChange={(e) => onChange(config.key, e.target.value)}
                    disabled={!config.is_editable}
                    className={inputClass}
                    placeholder={config.default_value?.toString() || ''}
                />
            )

        case 'number':
            return (
                <input
                    type="number"
                    value={currentValue || 0}
                    onChange={(e) => onChange(config.key, parseInt(e.target.value))}
                    disabled={!config.is_editable}
                    className={inputClass}
                />
            )

        case 'float':
            return (
                <input
                    type="number"
                    step="0.01"
                    value={currentValue || 0}
                    onChange={(e) => onChange(config.key, parseFloat(e.target.value))}
                    disabled={!config.is_editable}
                    className={inputClass}
                />
            )

        case 'json':
            return (
                <textarea
                    value={JSON.stringify(currentValue, null, 2) || ''}
                    onChange={(e) => {
                        try {
                            onChange(config.key, JSON.parse(e.target.value))
                        } catch {
                            // 允许输入不完整的 JSON
                        }
                    }}
                    disabled={!config.is_editable}
                    rows={2}
                    className={cn(inputClass, 'font-mono text-xs resize-none')}
                    placeholder="JSON"
                />
            )

        default:
            return <span className="text-xs text-gray-400">不支持的类型</span>
    }
}