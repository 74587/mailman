import { notFound } from 'next/navigation'
import { ActionDropdownRegressionClient } from './client'

export default function ActionDropdownRegressionPage() {
    if (process.env.NODE_ENV === 'production') {
        notFound()
    }

    return <ActionDropdownRegressionClient />
}
