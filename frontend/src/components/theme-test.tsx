'use client'

import { useTheme } from '@/components/theme-provider'
import { Sun, Moon, Monitor, Cherry } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ThemeTest() {
    const { theme, setTheme } = useTheme()

    const themes = [
        { id: 'light', name: '☀️ 浅色', icon: Sun },
        { id: 'dark', name: '🌙 深色', icon: Moon },
        // { id: 'sakura', name: '🌸 樱花粉', icon: Cherry }, // 临时隐藏
        { id: 'system', name: '💻 跟随系统', icon: Monitor },
    ] as const

    return (
        <div className="p-4 bg-card rounded-lg shadow-md border border-border">
            <h3 className="text-lg font-semibold mb-2 text-foreground">
                主题设置
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
                当前主题: <span className="font-mono bg-muted px-2 py-1 rounded">{theme}</span>
            </p>
            <div className="flex flex-wrap gap-3">
                {themes.map(({ id, name }) => (
                    <button
                        key={id}
                        onClick={() => setTheme(id)}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                            theme === id
                                ? "bg-primary-600 text-white"
                                : "bg-muted text-foreground hover:bg-muted/80"
                        )}
                    >
                        {name}
                    </button>
                ))}
            </div>
        </div>
    )
}