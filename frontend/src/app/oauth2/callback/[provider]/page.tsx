import OAuth2CallbackClient from './client'

// Required for Next.js static export with dynamic routes
// Must return at least one path for the export check to pass
export function generateStaticParams() {
    return [{ provider: '_' }]
}

export default function OAuth2CallbackPage() {
    return <OAuth2CallbackClient />
}