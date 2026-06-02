'use client'

import { useEffect, useState } from 'react'
import { PluginConfigForm } from '@/components/plugins/plugin-config-form'

const jsonSchema = {
    type: 'object',
    required: ['title'],
    properties: {
        title: {
            type: 'string',
            title: '标题',
            description: 'JSON Schema 字符串字段',
            default: '默认标题',
        },
        retries: {
            type: 'integer',
            title: '重试次数',
            default: 2,
            minimum: 0,
            maximum: 10,
            width: 'half',
        },
        enabled: {
            type: 'boolean',
            title: '启用',
            default: true,
        },
    },
}

const uiFieldSchema = {
    fields: [
        {
            name: 'level',
            label: '日志级别',
            type: 'select',
            default: 'info',
            options: [
                { label: '信息', value: 'info' },
                { label: '警告', value: 'warn' },
            ],
        },
        {
            name: 'tags',
            label: '标签',
            type: 'array',
            placeholder: '输入标签',
        },
        {
            name: 'headers',
            label: '请求头',
            type: 'key_value',
            default: { 'X-Test': '1' },
        },
    ],
}

export function PluginConfigFormRegressionClient() {
    const [isReady, setIsReady] = useState(false)
    const [jsonConfig, setJsonConfig] = useState<Record<string, unknown>>({})
    const [fieldsConfig, setFieldsConfig] = useState<Record<string, unknown>>({})

    useEffect(() => {
        setIsReady(true)
    }, [])

    return (
        <main
            className="min-h-screen bg-gray-50 p-8"
            data-ready={isReady}
            data-testid="plugin-config-form-regression"
        >
            <section className="mx-auto max-w-3xl space-y-8 rounded-lg border bg-white p-6">
                <div className="space-y-4" data-testid="json-schema-form">
                    <h1 className="text-lg font-semibold">JSON Schema</h1>
                    <PluginConfigForm
                        schema={jsonSchema}
                        value={jsonConfig}
                        onChange={setJsonConfig}
                    />
                    <pre data-testid="json-schema-output" className="rounded bg-gray-100 p-3 text-xs">
                        {JSON.stringify(jsonConfig)}
                    </pre>
                </div>

                <div className="space-y-4 border-t pt-6" data-testid="ui-field-schema-form">
                    <h2 className="text-lg font-semibold">UI Field Schema</h2>
                    <PluginConfigForm
                        schema={uiFieldSchema}
                        value={fieldsConfig}
                        onChange={setFieldsConfig}
                    />
                    <pre data-testid="ui-field-schema-output" className="rounded bg-gray-100 p-3 text-xs">
                        {JSON.stringify(fieldsConfig)}
                    </pre>
                </div>
            </section>
        </main>
    )
}
