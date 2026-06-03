'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster as SonnerToaster } from 'sonner'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { AuthProvider } from '@/context/auth-context'
import { KeyboardProvider, DefaultKeybindings } from '@/context/keyboard'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { HintModeProvider } from '@/components/hint-mode'
import EmailNotificationToast from '@/components/notifications/email-notification-toast'
import { ConfirmDialogProvider } from '@/hooks/use-confirm-dialog'

// Sonner Toaster with theme support
function ThemedSonnerToaster() {
    const { theme } = useTheme()
    // Map theme to sonner theme
    const sonnerTheme = theme === 'system'
        ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme === 'sakura' || theme === 'custom' ? 'light' : theme

    return (
        <SonnerToaster
            position="top-right"
            theme={sonnerTheme as 'light' | 'dark'}
            richColors
            closeButton
            toastOptions={{
                duration: 4000,
                className: 'sonner-toast',
            }}
        />
    )
}

export function Providers({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const normalizedPathname = pathname.replace(/\/+$/, '') || '/'
    const isOAuth2StandalonePage = normalizedPathname.startsWith('/oauth2')
    const isLegalPage = normalizedPathname === '/privacy-policy' || normalizedPathname === '/terms-of-service'
    const isDevRegressionPage =
        process.env.NODE_ENV !== 'production' && (
            normalizedPathname === '/dev/action-dropdown-regression' ||
            normalizedPathname === '/dev/plugin-config-form-regression' ||
            normalizedPathname === '/dev/configuration-menu-overflow-regression'
        )
    const isStandalonePublicPage = isOAuth2StandalonePage || isLegalPage || isDevRegressionPage
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 60 * 1000, // 1 minute
                        gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
                        retry: 1,
                        refetchOnWindowFocus: false,
                    },
                },
            })
    )

    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                {isStandalonePublicPage ? (
                    <>
                        {children}
                        <ThemedSonnerToaster />
                    </>
                ) : (
                    <AuthProvider>
                        <ConfirmDialogProvider>
                            <KeyboardProvider>
                                <HintModeProvider>
                                    <DefaultKeybindings />
                                    {children}
                                    <CommandPalette />
                                </HintModeProvider>
                            </KeyboardProvider>
                        </ConfirmDialogProvider>

                        <ThemedSonnerToaster />
                    </AuthProvider>
                )}
                {!isStandalonePublicPage && <EmailNotificationToast />}
            </ThemeProvider>
            <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
    )
}
