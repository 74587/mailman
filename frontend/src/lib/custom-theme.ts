'use client'

export const CUSTOM_THEME_STORAGE_KEY = 'mailman-custom-theme-config'
export const CUSTOM_THEME_CONFIG_KEY = 'custom-theme'
export const CUSTOM_THEME_CHANGE_EVENT = 'mailman-custom-theme-change'
export const CUSTOM_THEME_STYLE_ID = 'mailman-custom-theme-style'

export interface CustomThemeConfig {
    name: string
    variables: Record<string, string>
    css: string
    updatedAt?: string
}

export const DEFAULT_CUSTOM_THEME_VARIABLES: Record<string, string> = {
    '--background': '220 25% 98%',
    '--foreground': '222 47% 11%',
    '--card': '0 0% 100%',
    '--card-foreground': '222 47% 11%',
    '--popover': '0 0% 100%',
    '--popover-foreground': '222 47% 11%',
    '--primary': '221 83% 53%',
    '--primary-foreground': '0 0% 100%',
    '--secondary': '214 32% 91%',
    '--secondary-foreground': '222 47% 11%',
    '--muted': '214 32% 91%',
    '--muted-foreground': '215 16% 47%',
    '--accent': '213 94% 93%',
    '--accent-foreground': '222 47% 11%',
    '--border': '214 32% 91%',
    '--input': '214 32% 91%',
    '--ring': '221 83% 53%',
    '--radius': '0.75rem',
    '--sidebar-bg': '255 255 255',
    '--sidebar-text': '71 85 105',
    '--sidebar-text-hover': '15 23 42',
    '--sidebar-active': '37 99 235',
    '--sidebar-active-bg': '239 246 255',
    '--sidebar-hover-bg': '241 245 249',
    '--sidebar-border': '226 232 240',
}

export const DEFAULT_CUSTOM_THEME_CSS = `/* 自定义 CSS 会在 html.custom-theme 下生效。
   建议使用 html.custom-theme 作为作用域，避免影响登录页和邮件内容预览。 */

html.custom-theme .tab-bar {
  backdrop-filter: blur(14px);
}

html.custom-theme .card-hover {
  transition: transform 180ms ease, box-shadow 180ms ease;
}

html.custom-theme .card-hover:hover {
  transform: translateY(-2px);
}`

export const DEFAULT_CUSTOM_THEME_CONFIG: CustomThemeConfig = {
    name: '我的主题',
    variables: DEFAULT_CUSTOM_THEME_VARIABLES,
    css: DEFAULT_CUSTOM_THEME_CSS,
}

export const CUSTOM_THEME_TEMPLATES: Array<{
    id: string
    name: string
    description: string
    accent: string
    config: CustomThemeConfig
}> = [
    {
        id: 'ocean',
        name: '海盐蓝',
        description: '干净明亮的蓝绿色工作台',
        accent: '#0ea5e9',
        config: {
            name: '海盐蓝',
            variables: {
                ...DEFAULT_CUSTOM_THEME_VARIABLES,
                '--background': '204 45% 98%',
                '--foreground': '215 40% 16%',
                '--primary': '199 89% 48%',
                '--secondary': '199 64% 93%',
                '--muted': '202 38% 93%',
                '--accent': '187 72% 92%',
                '--border': '200 35% 87%',
                '--ring': '199 89% 48%',
                '--sidebar-bg': '240 249 255',
                '--sidebar-text': '51 65 85',
                '--sidebar-active': '2 132 199',
                '--sidebar-active-bg': '224 242 254',
                '--sidebar-hover-bg': '232 246 253',
                '--sidebar-border': '186 230 253',
            },
            css: `html.custom-theme .bg-blue-600 {
  box-shadow: 0 10px 24px rgb(14 165 233 / 0.18);
}`,
        },
    },
    {
        id: 'midnight',
        name: '午夜玻璃',
        description: '低亮度、强对比的深色主题',
        accent: '#8b5cf6',
        config: {
            name: '午夜玻璃',
            variables: {
                ...DEFAULT_CUSTOM_THEME_VARIABLES,
                '--background': '222 47% 8%',
                '--foreground': '210 40% 96%',
                '--card': '222 40% 11%',
                '--card-foreground': '210 40% 96%',
                '--popover': '222 40% 11%',
                '--popover-foreground': '210 40% 96%',
                '--primary': '258 90% 66%',
                '--secondary': '217 33% 18%',
                '--secondary-foreground': '210 40% 96%',
                '--muted': '217 33% 18%',
                '--muted-foreground': '215 20% 70%',
                '--accent': '258 50% 24%',
                '--accent-foreground': '250 100% 92%',
                '--border': '217 33% 20%',
                '--input': '217 33% 20%',
                '--ring': '258 90% 66%',
                '--sidebar-bg': '15 23 42',
                '--sidebar-text': '203 213 225',
                '--sidebar-text-hover': '248 250 252',
                '--sidebar-active': '167 139 250',
                '--sidebar-active-bg': '49 46 129',
                '--sidebar-hover-bg': '30 41 59',
                '--sidebar-border': '51 65 85',
            },
            css: `html.custom-theme body {
  background:
    radial-gradient(circle at top left, rgb(124 58 237 / 0.18), transparent 34rem),
    hsl(var(--background));
}

html.custom-theme .bg-white,
html.custom-theme .dark\\:bg-gray-800\\/50 {
  background-color: rgb(15 23 42 / 0.86) !important;
  backdrop-filter: blur(12px);
}`,
        },
    },
    {
        id: 'forest',
        name: '森林薄荷',
        description: '清爽绿调，适合长时间处理邮件',
        accent: '#10b981',
        config: {
            name: '森林薄荷',
            variables: {
                ...DEFAULT_CUSTOM_THEME_VARIABLES,
                '--background': '150 38% 97%',
                '--foreground': '164 42% 12%',
                '--primary': '160 84% 39%',
                '--secondary': '151 44% 90%',
                '--muted': '151 36% 91%',
                '--accent': '142 52% 90%',
                '--border': '150 29% 84%',
                '--ring': '160 84% 39%',
                '--sidebar-bg': '240 253 244',
                '--sidebar-text': '22 101 52',
                '--sidebar-active': '5 150 105',
                '--sidebar-active-bg': '220 252 231',
                '--sidebar-hover-bg': '236 253 245',
                '--sidebar-border': '187 247 208',
            },
            css: `html.custom-theme .text-green-600 {
  color: rgb(5 150 105) !important;
}`,
        },
    },
    {
        id: 'mist',
        name: '晨雾灰',
        description: '低饱和、中性色的安静后台',
        accent: '#64748b',
        config: {
            name: '晨雾灰',
            variables: {
                ...DEFAULT_CUSTOM_THEME_VARIABLES,
                '--background': '210 20% 97%',
                '--foreground': '215 28% 17%',
                '--primary': '215 20% 38%',
                '--secondary': '210 16% 90%',
                '--muted': '210 18% 92%',
                '--muted-foreground': '215 14% 46%',
                '--accent': '210 24% 90%',
                '--border': '214 18% 84%',
                '--ring': '215 20% 38%',
                '--sidebar-bg': '248 250 252',
                '--sidebar-text': '71 85 105',
                '--sidebar-active': '51 65 85',
                '--sidebar-active-bg': '226 232 240',
                '--sidebar-hover-bg': '241 245 249',
                '--sidebar-border': '226 232 240',
            },
            css: `html.custom-theme .shadow-sm {
  box-shadow: 0 8px 22px rgb(15 23 42 / 0.06) !important;
}`,
        },
    },
    {
        id: 'sunset',
        name: '石榴暖阳',
        description: '暖色但克制，适合运营看板',
        accent: '#f97316',
        config: {
            name: '石榴暖阳',
            variables: {
                ...DEFAULT_CUSTOM_THEME_VARIABLES,
                '--background': '38 55% 97%',
                '--foreground': '24 45% 14%',
                '--primary': '18 88% 54%',
                '--secondary': '34 82% 91%',
                '--muted': '35 45% 91%',
                '--muted-foreground': '26 24% 43%',
                '--accent': '14 82% 92%',
                '--border': '31 40% 84%',
                '--ring': '18 88% 54%',
                '--sidebar-bg': '255 247 237',
                '--sidebar-text': '124 45 18',
                '--sidebar-active': '234 88 12',
                '--sidebar-active-bg': '255 237 213',
                '--sidebar-hover-bg': '255 241 226',
                '--sidebar-border': '254 215 170',
            },
            css: `html.custom-theme .bg-red-50 {
  background-color: rgb(255 237 213 / 0.78) !important;
}`,
        },
    },
    {
        id: 'aurora',
        name: '极光紫青',
        description: '紫青撞色，适合演示和高活力团队',
        accent: '#06b6d4',
        config: {
            name: '极光紫青',
            variables: {
                ...DEFAULT_CUSTOM_THEME_VARIABLES,
                '--background': '240 45% 98%',
                '--foreground': '242 38% 16%',
                '--primary': '186 86% 43%',
                '--secondary': '250 78% 94%',
                '--muted': '244 40% 93%',
                '--muted-foreground': '243 18% 50%',
                '--accent': '275 78% 93%',
                '--accent-foreground': '262 45% 28%',
                '--border': '244 36% 86%',
                '--ring': '186 86% 43%',
                '--sidebar-bg': '245 243 255',
                '--sidebar-text': '76 29 149',
                '--sidebar-active': '8 145 178',
                '--sidebar-active-bg': '207 250 254',
                '--sidebar-hover-bg': '237 233 254',
                '--sidebar-border': '221 214 254',
            },
            css: `html.custom-theme body {
  background:
    radial-gradient(circle at 10% 0%, rgb(34 211 238 / 0.18), transparent 28rem),
    radial-gradient(circle at 90% 10%, rgb(168 85 247 / 0.14), transparent 26rem),
    hsl(var(--background));
}`,
        },
    },
    {
        id: 'contrast',
        name: '高对比黑',
        description: '更强可读性，适合暗光和大屏',
        accent: '#facc15',
        config: {
            name: '高对比黑',
            variables: {
                ...DEFAULT_CUSTOM_THEME_VARIABLES,
                '--background': '0 0% 4%',
                '--foreground': '0 0% 98%',
                '--card': '0 0% 8%',
                '--card-foreground': '0 0% 98%',
                '--popover': '0 0% 8%',
                '--popover-foreground': '0 0% 98%',
                '--primary': '48 96% 53%',
                '--primary-foreground': '0 0% 4%',
                '--secondary': '0 0% 14%',
                '--secondary-foreground': '0 0% 98%',
                '--muted': '0 0% 14%',
                '--muted-foreground': '0 0% 78%',
                '--accent': '48 70% 18%',
                '--accent-foreground': '48 100% 88%',
                '--border': '0 0% 22%',
                '--input': '0 0% 22%',
                '--ring': '48 96% 53%',
                '--sidebar-bg': '10 10 10',
                '--sidebar-text': '245 245 245',
                '--sidebar-text-hover': '255 255 255',
                '--sidebar-active': '250 204 21',
                '--sidebar-active-bg': '63 54 18',
                '--sidebar-hover-bg': '38 38 38',
                '--sidebar-border': '64 64 64',
            },
            css: `html.custom-theme .bg-white,
html.custom-theme .dark\\:bg-gray-800\\/50 {
  background-color: rgb(20 20 20 / 0.96) !important;
}`,
        },
    },
    {
        id: 'navy',
        name: '墨蓝专业',
        description: '沉稳商务风，适合团队长期使用',
        accent: '#38bdf8',
        config: {
            name: '墨蓝专业',
            variables: {
                ...DEFAULT_CUSTOM_THEME_VARIABLES,
                '--background': '213 38% 96%',
                '--foreground': '218 50% 14%',
                '--primary': '202 89% 48%',
                '--secondary': '214 38% 89%',
                '--muted': '214 32% 91%',
                '--muted-foreground': '215 18% 45%',
                '--accent': '204 94% 91%',
                '--border': '214 28% 84%',
                '--ring': '202 89% 48%',
                '--sidebar-bg': '15 23 42',
                '--sidebar-text': '203 213 225',
                '--sidebar-text-hover': '248 250 252',
                '--sidebar-active': '56 189 248',
                '--sidebar-active-bg': '12 74 110',
                '--sidebar-hover-bg': '30 41 59',
                '--sidebar-border': '51 65 85',
            },
            css: `html.custom-theme .tab-bar {
  border-bottom-color: rgb(14 165 233 / 0.18) !important;
}`,
        },
    },
    {
        id: 'rose',
        name: '玫瑰晨曦',
        description: '柔和粉玫色，轻量但不甜腻',
        accent: '#e11d48',
        config: {
            name: '玫瑰晨曦',
            variables: {
                ...DEFAULT_CUSTOM_THEME_VARIABLES,
                '--background': '350 45% 98%',
                '--foreground': '345 42% 16%',
                '--primary': '347 77% 50%',
                '--secondary': '345 68% 93%',
                '--muted': '346 40% 93%',
                '--muted-foreground': '343 18% 48%',
                '--accent': '330 70% 93%',
                '--border': '344 35% 86%',
                '--ring': '347 77% 50%',
                '--sidebar-bg': '255 241 242',
                '--sidebar-text': '136 19 55',
                '--sidebar-active': '225 29 72',
                '--sidebar-active-bg': '255 228 230',
                '--sidebar-hover-bg': '255 235 238',
                '--sidebar-border': '254 205 211',
            },
            css: `html.custom-theme .bg-blue-600 {
  box-shadow: 0 12px 26px rgb(225 29 72 / 0.16);
}`,
        },
    },
]

function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export function isCustomThemeTemporarilyDisabled(): boolean {
    if (!isBrowser()) return false

    try {
        const params = new URLSearchParams(window.location.search)
        return params.get('disableCustomTheme') === '1'
    } catch {
        return false
    }
}

export function sanitizeCustomCss(css: string): string {
    return css
        .replace(/<?style[^>]*>/gi, '')
        .replace(/<\/style>/gi, '')
        .replace(/@import\s+[^;]+;/gi, '/* @import removed */')
        .replace(/url\s*\([^)]*\)/gi, '/* url() removed */')
        .replace(/expression\s*\([^)]*\)/gi, '/* expression() removed */')
        .replace(/javascript\s*:/gi, '')
        .replace(/behavior\s*:/gi, '/* behavior removed */')
}

function sanitizeVariableValue(value: string): string {
    return value.replace(/[;{}<>]/g, '').trim()
}

export function normalizeCustomThemeConfig(config?: Partial<CustomThemeConfig> | null): CustomThemeConfig {
    return {
        ...DEFAULT_CUSTOM_THEME_CONFIG,
        ...(config || {}),
        name: typeof config?.name === 'string' && config.name.trim() ? config.name : DEFAULT_CUSTOM_THEME_CONFIG.name,
        variables: {
            ...DEFAULT_CUSTOM_THEME_VARIABLES,
            ...(config?.variables || {}),
        },
        css: typeof config?.css === 'string' ? sanitizeCustomCss(config.css) : DEFAULT_CUSTOM_THEME_CSS,
        updatedAt: config?.updatedAt,
    }
}

export function buildCustomThemeCss(config: CustomThemeConfig): string {
    const variables = {
        ...DEFAULT_CUSTOM_THEME_VARIABLES,
        ...(config.variables || {}),
    }

    const variableLines = Object.entries(variables)
        .filter(([key]) => key.startsWith('--'))
        .map(([key, value]) => `  ${key}: ${sanitizeVariableValue(String(value))};`)
        .join('\n')

    const safeCss = sanitizeCustomCss(config.css || '')

    return `html.custom-theme {
${variableLines}
}

html.custom-theme body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
}

html.custom-theme .from-white {
  --tw-gradient-from: rgb(var(--sidebar-bg)) var(--tw-gradient-from-position) !important;
  --tw-gradient-to: rgb(var(--sidebar-bg) / 0) var(--tw-gradient-to-position) !important;
  --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important;
}

html.custom-theme .to-gray-50\\/80 {
  --tw-gradient-to: rgb(var(--sidebar-bg) / 0.82) var(--tw-gradient-to-position) !important;
}

html.custom-theme .bg-gray-100\\/60,
html.custom-theme .hover\\:bg-gray-200\\/80:hover {
  background-color: rgb(var(--sidebar-hover-bg) / 0.72) !important;
}

html.custom-theme .bg-white,
html.custom-theme .bg-gray-50 {
  background-color: hsl(var(--card)) !important;
}

html.custom-theme .text-gray-900,
html.custom-theme .text-gray-800 {
  color: hsl(var(--foreground)) !important;
}

html.custom-theme .text-gray-600,
html.custom-theme .text-gray-500,
html.custom-theme .text-gray-400 {
  color: hsl(var(--muted-foreground)) !important;
}

html.custom-theme .border-gray-200,
html.custom-theme .border-gray-300 {
  border-color: hsl(var(--border)) !important;
}

html.custom-theme .bg-blue-600,
html.custom-theme .bg-blue-500,
html.custom-theme .bg-primary-600,
html.custom-theme .bg-primary-500 {
  background-color: hsl(var(--primary)) !important;
}

html.custom-theme .text-blue-600,
html.custom-theme .text-blue-500,
html.custom-theme .text-primary-600,
html.custom-theme .text-primary-500 {
  color: hsl(var(--primary)) !important;
}

html.custom-theme .ring-blue-500,
html.custom-theme .ring-primary-500 {
  --tw-ring-color: hsl(var(--ring)) !important;
}

${safeCss}`
}

export function getStoredCustomThemeConfig(): CustomThemeConfig {
    if (!isBrowser()) return DEFAULT_CUSTOM_THEME_CONFIG

    try {
        const raw = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY)
        if (!raw) return DEFAULT_CUSTOM_THEME_CONFIG

        const parsed = JSON.parse(raw) as CustomThemeConfig
        return normalizeCustomThemeConfig(parsed)
    } catch {
        return DEFAULT_CUSTOM_THEME_CONFIG
    }
}

export function saveStoredCustomThemeConfig(config: CustomThemeConfig): CustomThemeConfig {
    const nextConfig = {
        ...normalizeCustomThemeConfig(config),
        updatedAt: new Date().toISOString(),
    }

    if (isBrowser()) {
        localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(nextConfig))
        window.dispatchEvent(new Event(CUSTOM_THEME_CHANGE_EVENT))
    }

    return nextConfig
}

export function removeCustomThemeStyle(styleId = CUSTOM_THEME_STYLE_ID): void {
    if (!isBrowser()) return
    document.getElementById(styleId)?.remove()
}

export function applyCustomThemeStyle(config = getStoredCustomThemeConfig(), styleId = CUSTOM_THEME_STYLE_ID): void {
    if (!isBrowser()) return

    if (isCustomThemeTemporarilyDisabled()) {
        removeCustomThemeStyle(styleId)
        return
    }

    let style = document.getElementById(styleId) as HTMLStyleElement | null
    if (!style) {
        style = document.createElement('style')
        style.id = styleId
        document.head.appendChild(style)
    }

    style.textContent = buildCustomThemeCss(config)
}
