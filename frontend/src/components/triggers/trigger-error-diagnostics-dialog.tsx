'use client'

import { AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ErrorDiagnostics } from './error-diagnostics'

interface TriggerErrorDiagnosticsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerId?: number
  logId?: number
  error?: string
}

export function TriggerErrorDiagnosticsDialog({
  open,
  onOpenChange,
  triggerId,
  logId,
  error,
}: TriggerErrorDiagnosticsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto p-0">
        <DialogHeader className="px-6 pb-0 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            错误诊断
          </DialogTitle>
          <DialogDescription>
            分析这次触发器执行中的错误，并给出排查建议。
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6 pt-3">
          <ErrorDiagnostics
            triggerId={triggerId}
            logId={logId}
            error={error}
            onClose={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
