'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TemporarySyncPromptModalProps {
    isOpen: boolean
    accountEmail?: string
    reason: string
    currentConfigText: string
    actionLabel: string
    loading?: boolean
    onClose: () => void
    onContinue: () => void | Promise<void>
    onConfirm: (syncInterval: number, durationMinutes: number) => void | Promise<void>
}

const DEFAULT_SYNC_INTERVAL_SECONDS = 5
const DEFAULT_DURATION_MINUTES = 5

export default function TemporarySyncPromptModal({
    isOpen,
    accountEmail,
    reason,
    currentConfigText,
    actionLabel,
    loading = false,
    onClose,
    onContinue,
    onConfirm,
}: TemporarySyncPromptModalProps) {
    const [syncInterval, setSyncInterval] = useState(DEFAULT_SYNC_INTERVAL_SECONDS)
    const [durationMinutes, setDurationMinutes] = useState(DEFAULT_DURATION_MINUTES)

    useEffect(() => {
        if (isOpen) {
            setSyncInterval(DEFAULT_SYNC_INTERVAL_SECONDS)
            setDurationMinutes(DEFAULT_DURATION_MINUTES)
        }
    }, [isOpen])

    const handleConfirm = () => {
        const safeInterval = Math.max(1, Math.floor(syncInterval || DEFAULT_SYNC_INTERVAL_SECONDS))
        const safeDuration = Math.max(1, Math.floor(durationMinutes || DEFAULT_DURATION_MINUTES))
        onConfirm(safeInterval, safeDuration)
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            if (!open && !loading) {
                onClose()
            }
        }}>
            <DialogContent className="sm:max-w-[520px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                        同步配置可能导致等待
                    </DialogTitle>
                    <DialogDescription>
                        {accountEmail ? `${accountEmail} ` : ''}{reason}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                        当前配置：{currentConfigText}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label htmlFor="temp-sync-interval">临时间隔（秒）</Label>
                            <Input
                                id="temp-sync-interval"
                                type="number"
                                min={1}
                                value={syncInterval}
                                disabled={loading}
                                onChange={(event) => setSyncInterval(Number(event.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="temp-sync-duration">有效期（分钟）</Label>
                            <Input
                                id="temp-sync-duration"
                                type="number"
                                min={1}
                                value={durationMinutes}
                                disabled={loading}
                                onChange={(event) => setDurationMinutes(Number(event.target.value))}
                            />
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onContinue} disabled={loading}>
                        继续{actionLabel}
                    </Button>
                    <Button onClick={handleConfirm} disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        开启临时同步并{actionLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
