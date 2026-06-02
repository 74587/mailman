'use client'

import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface PluginConfigFormProps {
    schema?: Record<string, any>
    value: Record<string, any>
    onChange: (value: Record<string, any>) => void
    className?: string
}

type JsonDrafts = Record<string, string>
type JsonErrors = Record<string, string | null>
type NormalizedConfigField = {
    name: string
    schema: Record<string, any>
}

export function PluginConfigForm({
    schema,
    value,
    onChange,
    className,
}: PluginConfigFormProps) {
    const [jsonDrafts, setJsonDrafts] = useState<JsonDrafts>({})
    const [jsonErrors, setJsonErrors] = useState<JsonErrors>({})

    useEffect(() => {
        setJsonDrafts({})
        setJsonErrors({})
    }, [schema])

    const fields = normalizePluginConfigSchema(schema)

    if (fields.length === 0) {
        return null
    }

    const updateField = (name: string, nextValue: any) => {
        onChange({ ...value, [name]: nextValue })
    }

    return (
        <div className={cn('grid grid-cols-12 gap-4', className)}>
            {fields.map(({ name, schema: propSchema }) => {
                if (propSchema.hidden) return null

                const fieldValue = value[name] ?? propSchema.default
                const fieldType = propSchema.type || 'string'
                const label = propSchema.title || propSchema.label || propSchema.description || name.replace(/_/g, ' ')
                const description = propSchema.title || propSchema.label ? propSchema.description : ''
                const width = getFieldWidth(propSchema, fieldType)

                return (
                    <div key={name} className={cn('space-y-2', width)}>
                        {renderConfigField({
                            name,
                            label,
                            description,
                            propSchema,
                            value: fieldValue,
                            jsonDraft: jsonDrafts[name],
                            jsonError: jsonErrors[name],
                            onChange: updateField,
                            onJsonDraftChange: (draft) => setJsonDrafts(prev => ({ ...prev, [name]: draft })),
                            onJsonErrorChange: (error) => setJsonErrors(prev => ({ ...prev, [name]: error })),
                        })}
                    </div>
                )
            })}
        </div>
    )
}

export function normalizePluginConfigSchema(schema?: Record<string, any>): NormalizedConfigField[] {
    if (!schema) {
        return []
    }

    if (schema.properties && typeof schema.properties === 'object') {
        return Object.entries(schema.properties).map(([name, fieldSchema]: [string, any]) => ({
            name,
            schema: {
                ...fieldSchema,
                required: Array.isArray(schema.required) ? schema.required.includes(name) : fieldSchema.required,
            },
        }))
    }

    if (Array.isArray(schema.fields)) {
        return schema.fields
            .filter((field: any) => field?.name)
            .map((field: any) => ({
                name: field.name,
                schema: normalizeUIField(field),
            }))
    }

    return []
}

function normalizeUIField(field: Record<string, any>): Record<string, any> {
    const type = normalizeFieldType(field.type)

    return {
        ...field,
        type,
        title: field.title || field.label,
        description: field.description || field.tooltip,
        default: field.default ?? field.defaultValue,
        minimum: field.minimum ?? field.min,
        maximum: field.maximum ?? field.max,
        options: field.options,
        enum: field.enum,
    }
}

function normalizeFieldType(type?: string): string {
    switch (type) {
        case 'text':
        case 'select':
        case 'dynamic':
        case 'date':
        case 'time':
        case 'file':
        case 'code':
        case 'javascript':
        case 'gotemplate':
        case 'regex':
            return type
        case 'multi_select':
        case 'array':
            return 'array'
        case 'key_value':
            return 'object'
        case 'json':
            return 'json'
        case 'number':
        case 'boolean':
            return type
        default:
            return type || 'string'
    }
}

function getFieldWidth(propSchema: Record<string, any>, type: string) {
    if (propSchema.width === 'half' || propSchema.width === '1/2' || type === 'boolean') {
        return 'col-span-12 sm:col-span-6'
    }
    if (propSchema.width === '1/3') {
        return 'col-span-12 sm:col-span-4'
    }
    if (propSchema.width === '2/3') {
        return 'col-span-12 sm:col-span-8'
    }
    return 'col-span-12'
}

interface RenderFieldArgs {
    name: string
    label: string
    description?: string
    propSchema: Record<string, any>
    value: any
    jsonDraft?: string
    jsonError?: string | null
    onChange: (name: string, value: any) => void
    onJsonDraftChange: (draft: string) => void
    onJsonErrorChange: (error: string | null) => void
}

function renderConfigField({
    name,
    label,
    description,
    propSchema,
    value,
    jsonDraft,
    jsonError,
    onChange,
    onJsonDraftChange,
    onJsonErrorChange,
}: RenderFieldArgs) {
    const type = propSchema.type || 'string'

    if (type === 'boolean') {
        return (
            <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                    <Label>{label}</Label>
                    {description && <p className="text-xs text-muted-foreground">{description}</p>}
                </div>
                <Switch
                    checked={!!value}
                    disabled={propSchema.disabled}
                    onCheckedChange={(checked) => onChange(name, checked)}
                />
            </div>
        )
    }

    const selectOptions = getSelectOptions(propSchema)

    if (selectOptions.length > 0 || type === 'select' || type === 'dynamic') {
        const selectedValue = stringifySelectValue(value ?? propSchema.default ?? selectOptions[0]?.value ?? '')

        return (
            <>
                <FieldLabel label={label} description={description} />
                <Select
                    value={selectedValue}
                    onValueChange={(nextValue) => onChange(name, resolveSelectValue(nextValue, selectOptions))}
                    disabled={propSchema.disabled}
                >
                    <SelectTrigger>
                        <SelectValue placeholder={`选择${label}`} />
                    </SelectTrigger>
                    <SelectContent>
                        {selectOptions.map((option) => (
                            <SelectItem key={stringifySelectValue(option.value)} value={stringifySelectValue(option.value)}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </>
        )
    }

    if (type === 'integer' || type === 'number') {
        return (
            <>
                <FieldLabel label={label} description={description} />
                <Input
                    type="number"
                    value={value ?? propSchema.default ?? 0}
                    min={propSchema.minimum ?? propSchema.min}
                    max={propSchema.maximum ?? propSchema.max}
                    disabled={propSchema.disabled}
                    onChange={(event) => {
                        const parsed = type === 'integer'
                            ? parseInt(event.target.value, 10)
                            : parseFloat(event.target.value)
                        onChange(name, Number.isFinite(parsed) ? parsed : 0)
                    }}
                />
            </>
        )
    }

    if (type === 'array') {
        const values = Array.isArray(value)
            ? value
            : typeof value === 'string' && value
                ? value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean)
                : []

        return (
            <>
                <FieldLabel label={label} description={description} />
                <ArrayInput
                    values={values}
                    placeholder={propSchema.placeholder || '输入后按 Enter 添加'}
                    disabled={propSchema.disabled}
                    onChange={(nextValues) => onChange(name, nextValues)}
                />
            </>
        )
    }

    if (type === 'object' || type === 'json') {
        const draft = jsonDraft ?? formatJsonValue(value)

        return (
            <>
                <FieldLabel label={label} description={description} />
                <Textarea
                    value={draft}
                    onChange={(event) => {
                        onJsonDraftChange(event.target.value)
                        onJsonErrorChange(null)
                    }}
                    onBlur={() => {
                        try {
                            const parsed = draft.trim() ? JSON.parse(draft) : {}
                            onChange(name, parsed)
                            onJsonDraftChange(formatJsonValue(parsed))
                            onJsonErrorChange(null)
                        } catch (error) {
                            onJsonErrorChange(error instanceof Error ? error.message : 'JSON 格式不正确')
                        }
                    }}
                    rows={5}
                    className="font-mono text-xs"
                    disabled={propSchema.disabled}
                    placeholder={propSchema.placeholder || '{}'}
                />
                {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
            </>
        )
    }

    if (['code', 'javascript', 'gotemplate', 'regex'].includes(type)) {
        return (
            <>
                <FieldLabel label={label} description={description} />
                <Textarea
                    value={value ?? ''}
                    placeholder={propSchema.placeholder}
                    disabled={propSchema.disabled}
                    rows={6}
                    className="font-mono text-xs"
                    onChange={(event) => onChange(name, event.target.value)}
                />
            </>
        )
    }

    const htmlInputType = type === 'date' || type === 'time' || type === 'file' ? type : 'text'

    return (
        <>
            <FieldLabel label={label} description={description} />
            <Input
                type={htmlInputType}
                value={value ?? ''}
                placeholder={propSchema.placeholder}
                disabled={propSchema.disabled}
                onChange={(event) => onChange(name, event.target.value)}
            />
        </>
    )
}

function getSelectOptions(propSchema: Record<string, any>): Array<{ value: any; label: string }> {
    if (Array.isArray(propSchema.options) && propSchema.options.length > 0) {
        return propSchema.options.map((option: any) => {
            if (option && typeof option === 'object' && 'value' in option) {
                return {
                    value: option.value,
                    label: option.label || String(option.value),
                }
            }

            return {
                value: option,
                label: String(option),
            }
        })
    }

    if (Array.isArray(propSchema.enum)) {
        return propSchema.enum.map((option: any) => ({
            value: option,
            label: String(option),
        }))
    }

    return []
}

function stringifySelectValue(value: any) {
    if (value === undefined || value === null) {
        return ''
    }
    return String(value)
}

function resolveSelectValue(value: string, options: Array<{ value: any; label: string }>) {
    const option = options.find((item) => stringifySelectValue(item.value) === value)
    return option ? option.value : value
}

function FieldLabel({ label, description }: { label: string; description?: string }) {
    return (
        <div className="space-y-1">
            <Label>{label}</Label>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
    )
}

function ArrayInput({
    values,
    placeholder,
    disabled,
    onChange,
}: {
    values: any[]
    placeholder?: string
    disabled?: boolean
    onChange: (values: any[]) => void
}) {
    const [draft, setDraft] = useState('')

    const addValue = (rawValue: string) => {
        const additions = rawValue
            .split(/[,;\n]/)
            .map(item => item.trim())
            .filter(Boolean)

        if (additions.length === 0) return

        const nextValues = [...values]
        for (const item of additions) {
            if (!nextValues.includes(item)) {
                nextValues.push(item)
            }
        }
        onChange(nextValues)
        setDraft('')
    }

    return (
        <div className="space-y-2">
            {values.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {values.map((item, index) => (
                        <Badge key={`${item}-${index}`} variant="secondary" className="gap-1">
                            {String(item)}
                            <button
                                type="button"
                                className="text-muted-foreground hover:text-destructive"
                                disabled={disabled}
                                onClick={() => onChange(values.filter((_, itemIndex) => itemIndex !== index))}
                            >
                                ×
                            </button>
                        </Badge>
                    ))}
                </div>
            )}
            <Input
                value={draft}
                placeholder={placeholder}
                disabled={disabled}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => addValue(draft)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault()
                        addValue(draft)
                    }
                }}
            />
        </div>
    )
}

function formatJsonValue(value: any) {
    if (value === undefined || value === null || value === '') {
        return '{}'
    }
    if (typeof value === 'string') {
        return value
    }
    return JSON.stringify(value, null, 2)
}
