import LogDetailsClient from './client'

// Required for Next.js static export with dynamic routes
export function generateStaticParams() {
    return [{ id: '_' }]
}

export default function LogDetailsPage() {
    return <LogDetailsClient />
}