'use client'

import { Mail } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getProviderMetadata } from '@/lib/provider-metadata'
import {
    AOLIcon,
    AppleMailIcon,
    ComcastIcon,
    FastmailIcon,
    GmailIcon,
    MailRuIcon,
    NetEaseIcon,
    OutlookIcon,
    QQMailIcon,
    YahooIcon,
    YandexIcon,
    ZohoIcon,
} from '@/components/ui/brand-icons'

interface ProviderLogoProps {
    provider?: string
    size?: 'sm' | 'md' | 'lg'
    className?: string
}

const sizeClass = {
    sm: 'h-5 w-5 text-[9px]',
    md: 'h-7 w-7 text-[11px]',
    lg: 'h-9 w-9 text-xs',
}

export function ProviderLogo({ provider, size = 'md', className }: ProviderLogoProps) {
    const metadata = getProviderMetadata(provider)
    const iconSize = size === 'sm' ? 16 : size === 'lg' ? 22 : 18

    if (metadata.type === 'gmail') {
        return <GmailIcon size={iconSize} className={className} />
    }

    if (metadata.type === 'outlook') {
        return <OutlookIcon size={iconSize} className={className} />
    }

    const iconProps = { size: iconSize, className }
    switch (metadata.type) {
        case 'yahoo':
            return <YahooIcon {...iconProps} />
        case 'aol':
            return <AOLIcon {...iconProps} />
        case 'icloud':
            return <AppleMailIcon {...iconProps} />
        case 'fastmail':
            return <FastmailIcon {...iconProps} />
        case 'yandex':
            return <YandexIcon {...iconProps} />
        case 'mailru':
            return <MailRuIcon {...iconProps} />
        case 'zoho':
            return <ZohoIcon {...iconProps} />
        case 'qq':
            return <QQMailIcon {...iconProps} />
        case 'netease163':
            return <NetEaseIcon {...iconProps} label="163" />
        case 'netease126':
            return <NetEaseIcon {...iconProps} label="126" />
        case 'comcast':
            return <ComcastIcon {...iconProps} />
    }

    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-md font-semibold ring-1',
                sizeClass[size],
                metadata.colorClass,
                className
            )}
            title={metadata.displayName}
        >
            {metadata.initials || <Mail className="h-3.5 w-3.5" />}
        </span>
    )
}
