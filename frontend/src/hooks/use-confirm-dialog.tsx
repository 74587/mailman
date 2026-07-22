'use client'

import * as React from 'react'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// 确认对话框配置选项
export interface ConfirmDialogOptions {
    title: string
    description?: string
    confirmText?: string
    cancelText?: string
    variant?: 'default' | 'warning' | 'destructive'
}

// 确认对话框 Context
interface ConfirmDialogContextType {
    confirm: (options: ConfirmDialogOptions) => Promise<boolean>
}

const ConfirmDialogContext = React.createContext<ConfirmDialogContextType | null>(null)

// Provider 组件
export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
    const [open, setOpen] = React.useState(false)
    const [options, setOptions] = React.useState<ConfirmDialogOptions>({
        title: '',
        description: '',
        confirmText: '确定',
        cancelText: '取消',
        variant: 'default',
    })
    const resolveRef = React.useRef<((value: boolean) => void) | null>(null)

    const confirm = React.useCallback((opts: ConfirmDialogOptions): Promise<boolean> => {
        return new Promise((resolve) => {
            setOptions({
                title: opts.title,
                description: opts.description || '',
                confirmText: opts.confirmText || '确定',
                cancelText: opts.cancelText || '取消',
                variant: opts.variant || 'default',
            })
            resolveRef.current = resolve
            setOpen(true)
        })
    }, [])

    const handleConfirm = React.useCallback(() => {
        setOpen(false)
        resolveRef.current?.(true)
        resolveRef.current = null
    }, [])

    const handleCancel = React.useCallback(() => {
        setOpen(false)
        resolveRef.current?.(false)
        resolveRef.current = null
    }, [])

    return (
        <ConfirmDialogContext.Provider value={{ confirm }}>
            {children}
            <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{options.title}</AlertDialogTitle>
                        {options.description && (
                            <AlertDialogDescription>{options.description}</AlertDialogDescription>
                        )}
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={handleCancel}>
                            {options.cancelText}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleConfirm}
                            className={
                                options.variant === 'destructive'
                                    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-600'
                                    : options.variant === 'warning'
                                        ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-600'
                                        : ''
                            }
                        >
                            {options.confirmText}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </ConfirmDialogContext.Provider>
    )
}

// Hook
export function useConfirmDialog() {
    const context = React.useContext(ConfirmDialogContext)
    if (!context) {
        throw new Error('useConfirmDialog must be used within a ConfirmDialogProvider')
    }
    return context
}
