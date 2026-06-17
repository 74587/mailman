'use client'

import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle, GitBranch, Mail, XCircle, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { TriggerExecutionLog, TriggerExecutionStatus } from '@/types'
import { ExecutionTimeline } from './execution-timeline'

interface TriggerLogDetailViewProps {
  log: TriggerExecutionLog
  className?: string
  onDiagnostics?: (log: TriggerExecutionLog, error?: string) => void
}

function getStatusIcon(status: TriggerExecutionStatus) {
  switch (status) {
    case 'success':
      return <CheckCircle className="h-4 w-4 text-green-500" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500" />
    case 'partial':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />
    default:
      return <Clock className="h-4 w-4 text-gray-500" />
  }
}

function getStatusText(status: TriggerExecutionStatus) {
  switch (status) {
    case 'success':
      return '成功'
    case 'failed':
      return '失败'
    case 'partial':
      return '部分成功'
    default:
      return '未知'
  }
}

function getStatusColor(status: TriggerExecutionStatus) {
  switch (status) {
    case 'success':
      return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
    case 'failed':
      return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
    case 'partial':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400'
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
  }
}

function formatDateTime(value?: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatExecutionTime(ms?: number) {
  const value = ms || 0
  if (value < 1000) return `${value}ms`
  return `${(value / 1000).toFixed(2)}s`
}

function isPresent(value: unknown) {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

function formatAddressList(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '-'
  if (typeof value === 'string') return value || '-'
  return '-'
}

function accountEmail(account: any) {
  return account?.emailAddress || account?.EmailAddress || account?.email || '-'
}

function accountProvider(account: any) {
  return account?.mailProvider?.name || account?.MailProvider?.Name || account?.oauth2Provider?.name || account?.OAuth2Provider?.Name || '-'
}

function JsonBlock({ value, empty = '无数据' }: { value: unknown; empty?: string }) {
  if (!isPresent(value)) {
    return <div className="rounded bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400">{empty}</div>
  }

  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-3 text-xs leading-5 dark:bg-gray-900">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-sm font-medium text-gray-500 dark:text-gray-400">{label}</div>
      <div className="break-words text-sm text-gray-900 dark:text-gray-100">{value || '-'}</div>
    </div>
  )
}

export function TriggerLogDetailView({ log, className, onDiagnostics }: TriggerLogDetailViewProps) {
  const email = log.email
  const account = email?.Account
  const hasError = Boolean(log.error_message || log.condition_error || log.action_results?.some(result => result.error))

  return (
    <div className={cn('space-y-5', className)}>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>日志 #{log.id}</CardTitle>
            <Badge className={cn('inline-flex items-center gap-1', getStatusColor(log.status))}>
              {getStatusIcon(log.status)}
              {getStatusText(log.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InfoItem label="触发器" value={log.trigger?.name || `ID: ${log.trigger_id}`} />
            <InfoItem label="邮件 ID" value={log.email_id} />
            <InfoItem label="开始时间" value={formatDateTime(log.start_time)} />
            <InfoItem label="结束时间" value={formatDateTime(log.end_time)} />
            <InfoItem label="执行时间" value={formatExecutionTime(log.execution_ms)} />
            <InfoItem
              label="条件结果"
              value={(
                <span className={log.condition_result ? 'text-green-600' : 'text-red-600'}>
                  {log.condition_result ? '满足' : '不满足'}
                </span>
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>条件执行</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={cn('rounded-lg p-4', log.condition_result ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20')}>
            <div className="flex items-center gap-2">
              {log.condition_result ? <CheckCircle className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-red-500" />}
              <span className={cn('font-medium', log.condition_result ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200')}>
                {log.condition_result ? '条件满足' : '条件不满足'}
              </span>
            </div>

            {log.condition_error && (
              <div className="mt-3 rounded bg-red-100 p-3 dark:bg-red-900/30">
                <p className="text-sm text-red-800 dark:text-red-200">错误: {log.condition_error}</p>
                {onDiagnostics && (
                  <div className="mt-2 flex justify-end">
                    <Button type="button" variant="outline" size="sm" className="text-red-600" onClick={() => onDiagnostics(log, log.condition_error)}>
                      <AlertCircle className="mr-1 h-4 w-4" />
                      诊断错误
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {log.action_results && log.action_results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>动作执行结果</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {log.action_results.map((result, index) => (
                <div key={index} className={cn('rounded-lg p-4', result.success ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {result.success ? <CheckCircle className="h-5 w-5 shrink-0 text-green-500" /> : <XCircle className="h-5 w-5 shrink-0 text-red-500" />}
                      <span className={cn('break-words font-medium', result.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200')}>
                        {result.action_name} ({result.action_type})
                      </span>
                    </div>
                    <span className="text-sm text-gray-600 dark:text-gray-400">{formatExecutionTime(result.execution_ms)}</span>
                  </div>

                  {result.error && (
                    <div className="mt-3 rounded bg-red-100 p-3 dark:bg-red-900/30">
                      <p className="text-sm text-red-800 dark:text-red-200">错误: {result.error}</p>
                      {onDiagnostics && (
                        <div className="mt-2 flex justify-end">
                          <Button type="button" variant="outline" size="sm" className="text-red-600" onClick={() => onDiagnostics(log, result.error)}>
                            <AlertCircle className="mr-1 h-4 w-4" />
                            诊断错误
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <h4 className="mb-2 text-sm font-medium">输入数据</h4>
                      <JsonBlock value={result.input_data} empty="无输入数据" />
                    </div>
                    <div>
                      <h4 className="mb-2 text-sm font-medium">输出数据</h4>
                      <JsonBlock value={result.output_data} empty="无输出数据" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {log.execution_trace_data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              执行追踪时间轴
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ExecutionTimeline traceData={log.execution_trace_data} />
          </CardContent>
        </Card>
      )}

      {log.error_message && (
        <Card>
          <CardHeader>
            <CardTitle>错误信息</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-red-50 p-4 dark:bg-red-900/20">
              <p className="whitespace-pre-wrap break-words text-red-800 dark:text-red-200">{log.error_message}</p>
              {onDiagnostics && (
                <div className="mt-4 flex justify-end">
                  <Button type="button" variant="outline" className="text-red-600" onClick={() => onDiagnostics(log, log.error_message)}>
                    <AlertCircle className="mr-1 h-4 w-4" />
                    诊断错误
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {email && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              关联邮件与邮箱账户
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <InfoItem label="邮件主题" value={email.Subject || '-'} />
              <InfoItem label="邮箱账户" value={accountEmail(account)} />
              <InfoItem label="邮箱账户 ID" value={email.AccountID || '-'} />
              <InfoItem label="服务商" value={accountProvider(account)} />
              <InfoItem label="发件人" value={formatAddressList(email.From)} />
              <InfoItem label="收件人" value={formatAddressList(email.To)} />
              <InfoItem label="邮箱目录" value={email.MailboxName || '-'} />
              <InfoItem label="Message-ID" value={email.MessageID || '-'} />
            </div>

            {(email.Body || email.HTMLBody) && (
              <div className="mt-4">
                <h4 className="mb-2 text-sm font-medium">正文</h4>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs leading-5 dark:bg-gray-900">
                  {email.Body || email.HTMLBody}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {log.input_params && Object.keys(log.input_params).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>输入参数</CardTitle>
          </CardHeader>
          <CardContent>
            <JsonBlock value={log.input_params} />
          </CardContent>
        </Card>
      )}

      {onDiagnostics && hasError && !log.error_message && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" className="text-red-600" onClick={() => onDiagnostics(log)}>
            <AlertCircle className="mr-1 h-4 w-4" />
            错误诊断
          </Button>
        </div>
      )}
    </div>
  )
}
