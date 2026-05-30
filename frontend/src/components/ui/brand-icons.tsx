'use client'

import React from 'react'

interface IconProps {
    className?: string
    size?: number
}

// Gmail official icon
export const GmailIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
        <path d="M22 6C22 4.9 21.1 4 20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6Z" fill="#FFFFFF" stroke="#E0E0E0" strokeWidth="0.5" />
        <path d="M22 6L12 13L2 6" stroke="#EA4335" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 6L2 18" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" />
        <path d="M22 6V18" stroke="#34A853" strokeWidth="2" strokeLinecap="round" />
        <path d="M2 18H22" stroke="#FBBC05" strokeWidth="2" strokeLinecap="round" />
    </svg>
)

// Outlook official icon - Microsoft Outlook style
export const OutlookIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
        <defs>
            <linearGradient id="outlook-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0078D4" />
                <stop offset="100%" stopColor="#0050A3" />
            </linearGradient>
        </defs>
        {/* Main blue background */}
        <rect x="1" y="4" width="14" height="16" rx="1.5" fill="url(#outlook-gradient)" />
        {/* White "O" letter */}
        <ellipse cx="8" cy="12" rx="4" ry="4.5" stroke="white" strokeWidth="2" fill="none" />
        {/* Right side envelope panel */}
        <rect x="10" y="6" width="12" height="12" rx="1" fill="#28A8EA" />
        {/* Envelope lines */}
        <path d="M10 7L16 12L22 7" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 17L14 13.5" stroke="white" strokeWidth="1" strokeLinecap="round" />
        <path d="M22 17L18 13.5" stroke="white" strokeWidth="1" strokeLinecap="round" />
    </svg>
)

export const YahooIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#6001D2" />
        <path d="M6.4 6.8H9.5L12 10.6L14.5 6.8H17.6L13.4 12.9V17.2H10.6V12.9L6.4 6.8Z" fill="white" />
        <circle cx="17" cy="16.7" r="1.25" fill="white" />
    </svg>
)

export const AOLIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#111827" />
        <path d="M5.2 15.8L8.1 7H10.9L13.8 15.8H11.5L11 14.1H8L7.5 15.8H5.2ZM8.5 12.3H10.5L9.5 9L8.5 12.3Z" fill="white" />
        <path d="M14.4 7H16.6V15.8H14.4V7Z" fill="white" />
        <circle cx="18.4" cy="14.6" r="1.2" fill="white" />
    </svg>
)

export const AppleMailIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#F8FAFC" />
        <path d="M16.9 12.6C16.9 10.4 18.7 9.4 18.8 9.3C17.8 7.8 16.2 7.6 15.6 7.6C14.2 7.5 12.9 8.4 12.2 8.4C11.5 8.4 10.5 7.6 9.3 7.7C7.8 7.7 6.4 8.6 5.6 10C4 12.8 5.2 16.9 6.8 19.2C7.6 20.3 8.5 21.5 9.7 21.4C10.9 21.4 11.3 20.7 12.8 20.7C14.2 20.7 14.6 21.4 15.9 21.4C17.2 21.4 18 20.3 18.7 19.2C19.6 17.9 20 16.6 20 16.5C20 16.5 16.9 15.3 16.9 12.6Z" fill="#111827" />
        <path d="M14.8 6.1C15.4 5.4 15.8 4.4 15.7 3.5C14.9 3.5 13.9 4 13.3 4.7C12.8 5.3 12.3 6.4 12.4 7.2C13.3 7.3 14.2 6.8 14.8 6.1Z" fill="#111827" />
    </svg>
)

export const FastmailIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#2BB3A3" />
        <path d="M6 7H18V9.2H8.7V11H16.5V13.1H8.7V17H6V7Z" fill="white" />
    </svg>
)

export const YandexIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#FC3F1D" />
        <path d="M9.1 6H11.9L14.1 10.3L16.3 6H19L15.4 12.6V18H12.8V12.7L9.1 6Z" fill="white" />
    </svg>
)

export const MailRuIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#168DE2" />
        <path d="M12 6.1C8.6 6.1 6 8.7 6 12.1C6 15.4 8.5 17.9 11.7 17.9C13.2 17.9 14.4 17.4 15.2 16.6L14 15.2C13.5 15.7 12.7 16 11.8 16C9.7 16 8.1 14.4 8.1 12.1C8.1 9.8 9.8 8.1 12 8.1C14.3 8.1 15.9 9.7 15.9 12.1V12.5C15.9 13.2 15.6 13.6 15.1 13.6C14.7 13.6 14.5 13.4 14.5 12.9V9.8H12.7V10.4C12.3 10 11.8 9.8 11.1 9.8C9.8 9.8 8.8 10.8 8.8 12.2C8.8 13.6 9.7 14.6 11 14.6C11.8 14.6 12.4 14.3 12.8 13.8C13.1 14.6 13.8 15 14.9 15C16.8 15 18 14 18 12.3V12.1C18 8.7 15.4 6.1 12 6.1ZM11.7 13C11 13 10.6 12.6 10.6 12.1C10.6 11.5 11 11.1 11.7 11.1C12.3 11.1 12.8 11.5 12.8 12.1C12.8 12.6 12.3 13 11.7 13Z" fill="white" />
    </svg>
)

export const ZohoIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#FFFFFF" stroke="#E5E7EB" />
        <rect x="5" y="7" width="4" height="10" rx="1" fill="#E42527" />
        <rect x="9" y="7" width="4" height="10" rx="1" fill="#089949" />
        <rect x="13" y="7" width="4" height="10" rx="1" fill="#226DB4" />
        <rect x="17" y="7" width="2" height="10" rx="1" fill="#F9B21D" />
    </svg>
)

export const QQMailIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#FFFFFF" stroke="#D1D5DB" />
        <ellipse cx="12" cy="10.2" rx="4.4" ry="5.2" fill="#111827" />
        <ellipse cx="12" cy="12.5" rx="3.4" ry="3.6" fill="#FFFFFF" />
        <circle cx="10.5" cy="9.2" r="0.65" fill="#FFFFFF" />
        <circle cx="13.5" cy="9.2" r="0.65" fill="#FFFFFF" />
        <path d="M10.1 12.5C10.7 13 11.3 13.2 12 13.2C12.7 13.2 13.3 13 13.9 12.5" stroke="#F97316" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M8.4 15.2C10.1 16.9 13.8 17.1 15.6 15.2" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
)

export const NetEaseIcon: React.FC<IconProps & { label?: string }> = ({ className = '', size = 16, label = '163' }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#D71920" />
        <text x="12" y="15" textAnchor="middle" fontSize="7" fontWeight="700" fill="white" fontFamily="Arial, sans-serif">{label}</text>
    </svg>
)

export const ComcastIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" fill="#FFFFFF" stroke="#E5E7EB" />
        <path d="M7 16C5.7 14.9 5 13.5 5 12C5 8.9 7.8 6.5 12 6.5C16.2 6.5 19 8.9 19 12C19 13.5 18.3 14.9 17 16" stroke="#111827" strokeWidth="2" strokeLinecap="round" />
        <path d="M8.2 8.2C9.2 7.2 10.5 6.6 12 6.6C13.5 6.6 14.8 7.2 15.8 8.2" stroke="#F97316" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2.8" fill="#111827" />
    </svg>
)

// Thunderbird official icon
export const ThunderbirdIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
        {/* Bird body - gradient effect */}
        <defs>
            <linearGradient id="thunderbird-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0A84FF" />
                <stop offset="50%" stopColor="#0060DF" />
                <stop offset="100%" stopColor="#003EAA" />
            </linearGradient>
        </defs>
        {/* Main bird shape */}
        <path
            d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z"
            fill="url(#thunderbird-gradient)"
        />
        {/* Bird/envelope stylized icon */}
        <path
            d="M6 8L12 12L18 8M6 8V16H18V8M6 8L12 5L18 8"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
        />
        {/* Wing accent */}
        <path
            d="M8 14L5 11"
            stroke="white"
            strokeWidth="1.2"
            strokeLinecap="round"
        />
    </svg>
)

// Generic mail provider icon (for manual config)
export const MailConfigIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
        <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M2 6L12 13L22 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Plus sign for adding */}
        <circle cx="18" cy="17" r="4" fill="white" stroke="currentColor" strokeWidth="1.5" />
        <path d="M18 15V19M16 17H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
)

// Token/Key icon for OAuth token input
export const TokenKeyIcon: React.FC<IconProps> = ({ className = '', size = 16 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
    >
        <defs>
            <linearGradient id="token-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8B5CF6" />
                <stop offset="100%" stopColor="#6366F1" />
            </linearGradient>
        </defs>
        {/* Key shape */}
        <circle cx="8" cy="8" r="5" stroke="url(#token-gradient)" strokeWidth="2" fill="none" />
        <path d="M12 12L20 20" stroke="url(#token-gradient)" strokeWidth="2" strokeLinecap="round" />
        <path d="M17 17L17 20M17 20H20" stroke="url(#token-gradient)" strokeWidth="2" strokeLinecap="round" />
        <path d="M15 15L15 17" stroke="url(#token-gradient)" strokeWidth="2" strokeLinecap="round" />
        {/* Inner circle decoration */}
        <circle cx="8" cy="8" r="2" fill="url(#token-gradient)" />
    </svg>
)

export default {
    GmailIcon,
    OutlookIcon,
    YahooIcon,
    AOLIcon,
    AppleMailIcon,
    FastmailIcon,
    YandexIcon,
    MailRuIcon,
    ZohoIcon,
    QQMailIcon,
    NetEaseIcon,
    ComcastIcon,
    ThunderbirdIcon,
    MailConfigIcon,
    TokenKeyIcon
}
