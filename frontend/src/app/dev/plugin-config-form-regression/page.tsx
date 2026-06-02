import { notFound } from 'next/navigation'
import { PluginConfigFormRegressionClient } from './client'

export default function PluginConfigFormRegressionPage() {
    if (process.env.NODE_ENV === 'production') {
        notFound()
    }

    return <PluginConfigFormRegressionClient />
}
