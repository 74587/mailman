'use client'

import React, { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
    Package,
    Database,
    Code,
    FileText,
    Regex,
    Braces
} from 'lucide-react'

// 变量提取配置
interface VariableExtractConfig {
    source: 'email' | 'variable' | 'expression'
    source_field?: string
    source_variable?: string
    expression?: string
    expression_type?: 'javascript' | 'go_template' | 'regex' | 'jsonpath'
    output_name?: string
    return_type?: 'auto' | 'string' | 'json'
}

interface VariableExtractEditorProps {
    config: Partial<VariableExtractConfig> | Record<string, any>
    onChange: (config: VariableExtractConfig | Record<string, any>) => void
}

// 邮件字段选项
const emailFields = [
    { value: 'subject', label: '主题', icon: '📋' },
    { value: 'from', label: '发件人', icon: '👤' },
    { value: 'to', label: '收件人', icon: '👥' },
    { value: 'cc', label: '抄送', icon: '📋' },
    { value: 'bcc', label: '密送', icon: '🔒' },
    { value: 'body', label: '正文', icon: '📝' },
    { value: 'text_body', label: '纯文本正文', icon: '📄' },
    { value: 'html_body', label: 'HTML正文', icon: '🌐' },
    { value: 'message_id', label: '消息ID', icon: '🔖' },
    { value: 'mailbox_name', label: '邮箱名称', icon: '📬' },
]

// 表达式类型选项
const expressionTypes = [
    { value: 'javascript', label: 'JavaScript', icon: <Code className="h-4 w-4" />, description: '使用 JavaScript 表达式' },
    { value: 'go_template', label: 'Go Template', icon: <FileText className="h-4 w-4" />, description: '使用 Go 模板语法' },
    { value: 'regex', label: '正则表达式', icon: <Regex className="h-4 w-4" />, description: '使用正则表达式提取' },
    { value: 'jsonpath', label: 'JSONPath', icon: <Braces className="h-4 w-4" />, description: '使用 JSONPath 语法' },
]

// 返回类型选项
const returnTypes = [
    { value: 'auto', label: '自动', description: '根据提取结果自动确定类型' },
    { value: 'string', label: '字符串', description: '强制转换为字符串' },
    { value: 'json', label: 'JSON', description: '转换为 JSON 字符串' },
]

export function VariableExtractEditor({
    config,
    onChange
}: VariableExtractEditorProps) {
    // 确保 config 有默认值
    const safeConfig: VariableExtractConfig = {
        source: config?.source || 'email',
        source_field: config?.source_field || 'subject',
        source_variable: config?.source_variable || '',
        expression: config?.expression || '',
        expression_type: config?.expression_type || 'javascript',
        output_name: config?.output_name || '',
        return_type: config?.return_type || 'auto'
    }

    // 更新配置
    const updateConfig = useCallback((updates: Partial<VariableExtractConfig>) => {
        onChange({ ...safeConfig, ...updates })
    }, [safeConfig, onChange])

    // 获取表达式占位符
    const getExpressionPlaceholder = () => {
        switch (safeConfig.expression_type) {
            case 'javascript':
                return '例如: $.Subject 或 value.match(/\\d+/)[0]'
            case 'go_template':
                return '例如: {{.Value}} 或 {{.Email.Subject}}'
            case 'regex':
                return '例如: \\d{6} 或 (code|密码)[:：]\\s*(\\d+)'
            case 'jsonpath':
                return '例如: $.data.code 或 $.result[0].value'
            default:
                return '输入表达式'
        }
    }

    // 获取表达式帮助文本
    const getExpressionHelp = () => {
        switch (safeConfig.expression_type) {
            case 'javascript':
                return '使用 $ 访问邮件数据，$var 访问变量池，value 访问源值'
            case 'go_template':
                return '使用 {{.Value}} 访问源值，{{.Email}} 访问邮件数据'
            case 'regex':
                return '如果有捕获组，返回第一个捕获组的值；否则返回整个匹配'
            case 'jsonpath':
                return '使用 $.field 格式访问 JSON 数据字段'
            default:
                return ''
        }
    }

    return (
        <div className="space-y-4">
            {/* 头部说明 */}
            <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-indigo-500" />
                <h3 className="font-medium">变量提取配置</h3>
            </div>

            {/* 数据来源选择 */}
            <Card>
                <CardHeader className="py-3 px-4">
                    <Label className="text-sm font-medium flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        数据来源
                    </Label>
                </CardHeader>
                <CardContent className="pt-0">
                    <div className="grid grid-cols-3 gap-2">
                        <Button
                            variant={safeConfig.source === 'email' ? 'default' : 'outline'}
                            onClick={() => updateConfig({ source: 'email' })}
                            className="flex flex-col h-auto py-3"
                        >
                            <span className="text-lg mb-1">📧</span>
                            <span className="text-xs">邮件字段</span>
                        </Button>
                        <Button
                            variant={safeConfig.source === 'variable' ? 'default' : 'outline'}
                            onClick={() => updateConfig({ source: 'variable' })}
                            className="flex flex-col h-auto py-3"
                        >
                            <span className="text-lg mb-1">📦</span>
                            <span className="text-xs">变量</span>
                        </Button>
                        <Button
                            variant={safeConfig.source === 'expression' ? 'default' : 'outline'}
                            onClick={() => updateConfig({ source: 'expression' })}
                            className="flex flex-col h-auto py-3"
                        >
                            <span className="text-lg mb-1">⚡</span>
                            <span className="text-xs">表达式</span>
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* 根据来源显示不同配置 */}
            {safeConfig.source === 'email' && (
                <Card>
                    <CardHeader className="py-3 px-4">
                        <Label className="text-sm font-medium">选择邮件字段</Label>
                    </CardHeader>
                    <CardContent className="pt-0">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                            {emailFields.map(field => (
                                <Button
                                    key={field.value}
                                    variant={safeConfig.source_field === field.value ? 'default' : 'outline'}
                                    onClick={() => updateConfig({ source_field: field.value })}
                                    className="flex flex-col h-auto py-2 text-xs"
                                    size="sm"
                                >
                                    <span className="text-base mb-0.5">{field.icon}</span>
                                    {field.label}
                                </Button>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {safeConfig.source === 'variable' && (
                <Card>
                    <CardHeader className="py-3 px-4">
                        <Label className="text-sm font-medium">变量名</Label>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2">
                        <Input
                            value={safeConfig.source_variable || ''}
                            onChange={(e) => updateConfig({ source_variable: e.target.value })}
                            placeholder="输入变量名，如：ai_result 或 _"
                        />
                        <div className="flex flex-wrap gap-1">
                            <Badge
                                variant="outline"
                                className="cursor-pointer hover:bg-gray-100"
                                onClick={() => updateConfig({ source_variable: '_' })}
                            >
                                $_ (上一步输出)
                            </Badge>
                            <Badge
                                variant="outline"
                                className="cursor-pointer hover:bg-gray-100"
                                onClick={() => updateConfig({ source_variable: 'ai_result' })}
                            >
                                ai_result
                            </Badge>
                            <Badge
                                variant="outline"
                                className="cursor-pointer hover:bg-gray-100"
                                onClick={() => updateConfig({ source_variable: 'extracted' })}
                            >
                                extracted
                            </Badge>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* 表达式类型和内容 */}
            <Card>
                <CardHeader className="py-3 px-4">
                    <Label className="text-sm font-medium flex items-center gap-2">
                        <Code className="h-4 w-4" />
                        提取表达式 (可选)
                    </Label>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                    {/* 表达式类型选择 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {expressionTypes.map(type => (
                            <Button
                                key={type.value}
                                variant={safeConfig.expression_type === type.value ? 'default' : 'outline'}
                                onClick={() => updateConfig({ expression_type: type.value as any })}
                                className="flex items-center gap-1 text-xs"
                                size="sm"
                            >
                                {type.icon}
                                {type.label}
                            </Button>
                        ))}
                    </div>

                    {/* 表达式输入 */}
                    <Textarea
                        value={safeConfig.expression || ''}
                        onChange={(e) => updateConfig({ expression: e.target.value })}
                        placeholder={getExpressionPlaceholder()}
                        className="font-mono text-sm min-h-[80px]"
                    />

                    <p className="text-xs text-gray-500">
                        {getExpressionHelp()}
                    </p>
                </CardContent>
            </Card>

            {/* 输出配置 */}
            <Card>
                <CardHeader className="py-3 px-4">
                    <Label className="text-sm font-medium">输出配置</Label>
                </CardHeader>
                <CardContent className="pt-0 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* 输出变量名 */}
                        <div className="space-y-2">
                            <Label className="text-sm">输出变量名 (可选)</Label>
                            <Input
                                value={safeConfig.output_name || ''}
                                onChange={(e) => updateConfig({ output_name: e.target.value })}
                                placeholder="将结果保存到变量，如：extracted_code"
                            />
                            <p className="text-xs text-gray-500">
                                留空则仅作为返回值，不保存到变量池
                            </p>
                        </div>

                        {/* 返回类型 */}
                        <div className="space-y-2">
                            <Label className="text-sm">返回类型</Label>
                            <Select
                                value={safeConfig.return_type || 'auto'}
                                onValueChange={(value) => updateConfig({ return_type: value as any })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="选择返回类型" />
                                </SelectTrigger>
                                <SelectContent>
                                    {returnTypes.map(type => (
                                        <SelectItem key={type.value} value={type.value}>
                                            <div>
                                                <div>{type.label}</div>
                                                <div className="text-xs text-gray-500">{type.description}</div>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* 预览提示 */}
            <div className="text-xs text-gray-500 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                <p><strong>配置预览：</strong></p>
                <p className="mt-1 font-mono">
                    从 <Badge variant="outline" className="mx-1">
                        {safeConfig.source === 'email'
                            ? emailFields.find(f => f.value === safeConfig.source_field)?.label || safeConfig.source_field
                            : safeConfig.source === 'variable'
                                ? `变量 ${safeConfig.source_variable || '(未设置)'}`
                                : '表达式结果'
                        }
                    </Badge>
                    提取数据
                    {safeConfig.expression && (
                        <span>，使用 <Badge variant="outline" className="mx-1">
                            {expressionTypes.find(t => t.value === safeConfig.expression_type)?.label}
                        </Badge> 处理</span>
                    )}
                    {safeConfig.output_name && (
                        <span>，保存到 <Badge variant="outline" className="mx-1">
                            {safeConfig.output_name}
                        </Badge></span>
                    )}
                </p>
            </div>
        </div>
    )
}

export default VariableExtractEditor
