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

export const getWebSocketUrl = (path: string): string => {
    const apiOrigin = getApiOrigin()
    const origin = apiOrigin || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080')
    const url = new URL(path, origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
}
