import { notFound } from 'next/navigation'
import ProxyPoolTab from '@/components/tabs/proxy-pool-tab'

export default function ProxyPoolRegressionPage() {
    if (process.env.NODE_ENV === 'production') {
        notFound()
    }

    return (
        <main className="h-screen min-h-[640px]">
            <ProxyPoolTab />
        </main>
    )
}
