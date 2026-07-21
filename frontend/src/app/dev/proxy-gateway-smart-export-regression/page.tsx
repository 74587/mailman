import { notFound } from 'next/navigation'
import ProxyGatewayTab from '@/components/tabs/proxy-gateway-tab'

export default function ProxyGatewaySmartExportRegressionPage({ searchParams }: {
    searchParams?: { section?: string }
}) {
    if (process.env.NODE_ENV === 'production') {
        notFound()
    }

    return (
        <main className="h-screen min-h-[640px]">
            <ProxyGatewayTab section={searchParams?.section === 'gateways' ? 'gateways' : 'accounts'} />
        </main>
    )
}
