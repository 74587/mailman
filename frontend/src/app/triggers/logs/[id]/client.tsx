'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TriggerErrorDiagnosticsDialog } from '@/components/triggers/trigger-error-diagnostics-dialog'
import { TriggerLogDetailView } from '@/components/triggers/trigger-log-detail-view'
import { triggerService } from '@/services/trigger.service'
import { TriggerExecutionLog } from '@/types'

export default function LogDetailsClient() {
  const params = useParams()
  const router = useRouter()
  const logId = parseInt(params.id as string, 10)

  const [log, setLog] = useState<TriggerExecutionLog | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [diagnosticError, setDiagnosticError] = useState<string | undefined>()

  useEffect(() => {
    loadLog()
  }, [logId])

  const loadLog = async () => {
    try {
      setIsLoading(true)
      setError(null)

      const logData = await triggerService.getTriggerLog(logId)
      setLog(logData)
    } catch (err) {
      console.error('加载日志失败:', err)
      setError('加载日志数据失败，请重试')
    } finally {
      setIsLoading(false)
    }
  }

  const exportLog = () => {
    if (!log) return

    const logData = JSON.stringify(log, null, 2)
    const blob = new Blob([logData], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trigger-log-${log.id}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Button>
          <h1 className="text-xl font-bold">执行日志详情</h1>
        </div>

        {log && (
          <Button variant="outline" size="sm" onClick={exportLog}>
            <Download className="mr-1 h-4 w-4" />
            导出日志
          </Button>
        )}
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            <p className="mt-4 text-gray-600">加载中...</p>
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="p-6">
            <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-red-700">
              {error}
            </div>
          </CardContent>
        </Card>
      ) : log ? (
        <TriggerLogDetailView
          log={log}
          onDiagnostics={(_, nextError) => {
            setDiagnosticError(nextError || log.error_message || log.condition_error)
            setDiagnosticsOpen(true)
          }}
        />
      ) : (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-gray-600">日志不存在或已被删除</p>
          </CardContent>
        </Card>
      )}

      <TriggerErrorDiagnosticsDialog
        open={diagnosticsOpen}
        onOpenChange={setDiagnosticsOpen}
        triggerId={log?.trigger_id}
        logId={log?.id}
        error={diagnosticError}
      />
    </div>
  )
}
