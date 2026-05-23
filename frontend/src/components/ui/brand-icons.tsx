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
    ThunderbirdIcon,
    MailConfigIcon,
    TokenKeyIcon
}
