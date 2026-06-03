import { notFound } from 'next/navigation'
import { ConfigurationMenuOverflowRegressionClient } from './client'

export default function ConfigurationMenuOverflowRegressionPage() {
    if (process.env.NODE_ENV === 'production') {
        notFound()
    }

    return <ConfigurationMenuOverflowRegressionClient />
}
