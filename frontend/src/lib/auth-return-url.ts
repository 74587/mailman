const AUTH_RETURN_URL_KEY = 'mailman:auth-return-url'

export function isSafeInternalReturnUrl(value: string | null | undefined): value is string {
    if (!value || !value.startsWith('/') || value.startsWith('//')) return false
    try {
        const parsed = new URL(value, 'https://mailman.local')
        return parsed.origin === 'https://mailman.local' && !parsed.pathname.startsWith('/login') && !parsed.pathname.startsWith('/oauth2/callback')
    } catch {
        return false
    }
}

export function rememberAuthReturnUrl(value?: string) {
    if (typeof window === 'undefined') return
    const candidate = value || `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (!isSafeInternalReturnUrl(candidate)) return
    try {
        sessionStorage.setItem(AUTH_RETURN_URL_KEY, candidate)
    } catch {
        // Some embedded/private browsing environments disable sessionStorage.
    }
}

export function getAuthReturnUrl(): string {
    if (typeof window === 'undefined') return '/main'
    try {
        const candidate = sessionStorage.getItem(AUTH_RETURN_URL_KEY)
        return isSafeInternalReturnUrl(candidate) ? candidate : '/main'
    } catch {
        return '/main'
    }
}

export function clearAuthReturnUrl() {
    if (typeof window === 'undefined') return
    try {
        sessionStorage.removeItem(AUTH_RETURN_URL_KEY)
    } catch {
        // Navigation itself still works without persisted return state.
    }
}
