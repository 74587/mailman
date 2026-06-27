const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

const configuredApiOrigin = (): string | null => {
    const value = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL
    if (!value) {
        return null
    }

    return trimTrailingSlash(value)
}

export const getApiOrigin = (): string => {
    const configured = configuredApiOrigin()
    if (configured) {
        return configured
    }

    if (typeof window === 'undefined') {
        return ''
    }

    if (process.env.NODE_ENV === 'development' || window.location.port === '3000') {
        return 'http://localhost:8080'
    }

    return window.location.origin
}

export const getApiBaseUrl = (): string => {
    const origin = getApiOrigin()
    return origin ? `${origin}/api` : '/api'
}

export const getWebSocketUrl = (path: string, params?: Record<string, string | null | undefined>): string => {
    const apiOrigin = getApiOrigin()
    const origin = apiOrigin || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080')
    const url = new URL(path, origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value) {
                url.searchParams.set(key, value)
            }
        })
    }
    return url.toString()
}

export const getBrowserAuthToken = (): string | null => {
    if (typeof window === 'undefined') {
        return null
    }

    const token = localStorage.getItem('auth_token')
    if (token) return token

    const legacyToken = localStorage.getItem('sessionToken') || localStorage.getItem('token')
    if (legacyToken) {
        localStorage.setItem('auth_token', legacyToken)
        localStorage.removeItem('sessionToken')
        localStorage.removeItem('token')
        return legacyToken
    }

    return null
}

export const getAuthenticatedWebSocketUrl = (path: string): string | null => {
    const token = getBrowserAuthToken()
    if (!token) {
        return null
    }

    return getWebSocketUrl(path, { token })
}
