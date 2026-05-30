import { OAuth2ProviderType } from '@/types'

export interface ProviderMetadata {
    type: string
    displayName: string
    shortName?: string
    colorClass: string
    badgeClass: string
    initials: string
    oauth2: boolean
    domains?: string[]
    defaultScopes?: string[]
    protectedScopes?: boolean
    clientSecretRequired?: boolean
    manualCodeAuth?: boolean
    manualRedirectUri?: string
}

export const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
    gmail: {
        type: 'gmail',
        displayName: 'Gmail',
        initials: 'G',
        colorClass: 'bg-red-50 text-red-600 ring-red-100 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50',
        badgeClass: 'bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/50',
        oauth2: true,
        protectedScopes: true,
        manualCodeAuth: true,
        manualRedirectUri: 'http://localhost',
        domains: ['gmail.com', 'googlemail.com'],
        defaultScopes: [
            'https://mail.google.com/',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
        ],
    },
    outlook: {
        type: 'outlook',
        displayName: 'Outlook',
        initials: 'O',
        colorClass: 'bg-blue-50 text-blue-600 ring-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900/50',
        badgeClass: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-900/50',
        oauth2: true,
        domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'office365.com'],
        defaultScopes: [
            'https://outlook.office.com/IMAP.AccessAsUser.All',
            'https://outlook.office.com/POP.AccessAsUser.All',
            'https://outlook.office.com/SMTP.Send',
            'offline_access',
        ],
    },
    yahoo: {
        type: 'yahoo',
        displayName: 'Yahoo',
        initials: 'Y!',
        colorClass: 'bg-purple-50 text-purple-700 ring-purple-100 dark:bg-purple-950/40 dark:text-purple-300 dark:ring-purple-900/50',
        badgeClass: 'bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-900/50',
        oauth2: true,
        manualCodeAuth: true,
        manualRedirectUri: 'https://127.0.0.1',
        domains: ['yahoo.com', 'ymail.com', 'rocketmail.com', 'att.net'],
        defaultScopes: ['mail-w', 'ycal-w', 'sdct-w'],
    },
    aol: {
        type: 'aol',
        displayName: 'AOL',
        initials: 'A',
        colorClass: 'bg-cyan-50 text-cyan-700 ring-cyan-100 dark:bg-cyan-950/40 dark:text-cyan-300 dark:ring-cyan-900/50',
        badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-100 dark:bg-cyan-950/30 dark:text-cyan-300 dark:border-cyan-900/50',
        oauth2: true,
        manualCodeAuth: true,
        manualRedirectUri: 'https://127.0.0.1',
        domains: ['aol.com'],
        defaultScopes: ['mail-w', 'ycal-w', 'sdct-w'],
    },
    fastmail: {
        type: 'fastmail',
        displayName: 'Fastmail',
        initials: 'F',
        colorClass: 'bg-teal-50 text-teal-700 ring-teal-100 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-900/50',
        badgeClass: 'bg-teal-50 text-teal-700 border-teal-100 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-900/50',
        oauth2: true,
        domains: ['fastmail.com', 'fastmail.fm'],
        defaultScopes: [
            'https://www.fastmail.com/dev/protocol-imap',
            'https://www.fastmail.com/dev/protocol-smtp',
        ],
    },
    yandex: {
        type: 'yandex',
        displayName: 'Yandex',
        initials: 'Ya',
        colorClass: 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50',
        badgeClass: 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/50',
        oauth2: true,
        domains: ['yandex.com', 'yandex.ru', 'ya.ru'],
        defaultScopes: ['mail:imap_full', 'mail:smtp'],
    },
    mailru: {
        type: 'mailru',
        displayName: 'Mail.ru',
        initials: '@',
        colorClass: 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900/50',
        badgeClass: 'bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900/50',
        oauth2: true,
        domains: ['mail.ru', 'inbox.ru', 'list.ru', 'bk.ru'],
        defaultScopes: ['mail.imap'],
    },
    comcast: {
        type: 'comcast',
        displayName: 'Comcast',
        initials: 'C',
        colorClass: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50',
        oauth2: true,
        domains: ['comcast.net', 'xfinity.com'],
        defaultScopes: ['https://email.comcast.net/', 'profile', 'openid'],
    },
    icloud: {
        type: 'icloud',
        displayName: 'iCloud',
        initials: 'i',
        colorClass: 'bg-slate-50 text-slate-700 ring-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-800',
        badgeClass: 'bg-slate-50 text-slate-700 border-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800',
        oauth2: false,
        domains: ['icloud.com', 'me.com', 'mac.com'],
    },
    zoho: {
        type: 'zoho',
        displayName: 'Zoho',
        initials: 'Z',
        colorClass: 'bg-lime-50 text-lime-700 ring-lime-100 dark:bg-lime-950/40 dark:text-lime-300 dark:ring-lime-900/50',
        badgeClass: 'bg-lime-50 text-lime-700 border-lime-100 dark:bg-lime-950/30 dark:text-lime-300 dark:border-lime-900/50',
        oauth2: false,
        domains: ['zoho.com', 'zohomail.com'],
    },
    qq: {
        type: 'qq',
        displayName: 'QQ Mail',
        initials: 'Q',
        colorClass: 'bg-orange-50 text-orange-700 ring-orange-100 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900/50',
        badgeClass: 'bg-orange-50 text-orange-700 border-orange-100 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-900/50',
        oauth2: false,
        domains: ['qq.com', 'foxmail.com'],
    },
    netease163: {
        type: 'netease163',
        displayName: '163 Mail',
        initials: '163',
        colorClass: 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50',
        badgeClass: 'bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/50',
        oauth2: false,
        domains: ['163.com'],
    },
    netease126: {
        type: 'netease126',
        displayName: '126 Mail',
        initials: '126',
        colorClass: 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/50',
        badgeClass: 'bg-red-50 text-red-700 border-red-100 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/50',
        oauth2: false,
        domains: ['126.com'],
    },
}

export const OAUTH2_PROVIDER_TYPES = Object.values(PROVIDER_METADATA)
    .filter((provider) => provider.oauth2)
    .map((provider) => provider.type as OAuth2ProviderType)

export function getProviderMetadata(provider?: string): ProviderMetadata {
    const key = (provider || '').toLowerCase()
    return PROVIDER_METADATA[key] || {
        type: key || 'custom',
        displayName: provider || 'Custom',
        initials: (provider || 'M').slice(0, 2).toUpperCase(),
        colorClass: 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700',
        badgeClass: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
        oauth2: false,
    }
}

export function getProviderDisplayName(provider?: string): string {
    return getProviderMetadata(provider).displayName
}

export function inferProviderTypeFromEmail(email?: string): string | undefined {
    const domain = email?.split('@')[1]?.toLowerCase()
    if (!domain) return undefined

    return Object.values(PROVIDER_METADATA).find((provider) => provider.domains?.includes(domain))?.type
}

export function isProviderClientSecretRequired(provider?: string): boolean {
    return !!getProviderMetadata(provider).clientSecretRequired
}

export function supportsProviderManualCodeAuth(provider?: string): boolean {
    return !!getProviderMetadata(provider).manualCodeAuth
}
