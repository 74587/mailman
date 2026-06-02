'use client'

import { useEffect, useMemo, useState } from 'react'
import { Puzzle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FieldSelectorWithPreview } from '@/components/expression-builder/field-selector-with-preview'

const options = Array.from({ length: 36 }, (_, index) => {
    const number = String(index + 1).padStart(2, '0')

    return {
        id: `option_${number}`,
        label: `条件选项 ${number}`,
        description: `用于验证配置菜单滚动和命中区域的候选项 ${number}`,
    }
})

const testData = Object.fromEntries(
    Array.from({ length: 36 }, (_, index) => {
        const number = String(index + 1).padStart(2, '0')
        return [`field_${number}`, `value-${number}`]
    })
)

export function ConfigurationMenuOverflowRegressionClient() {
    const [isReady, setIsReady] = useState(false)
    const [selectValue, setSelectValue] = useState('')
    const [dropdownValue, setDropdownValue] = useState('')
    const [fieldValue, setFieldValue] = useState('')
    const selectedSelectOption = useMemo(
        () => options.find((option) => option.id === selectValue),
        [selectValue]
    )

    useEffect(() => {
        setIsReady(true)
    }, [])

    return (
        <main
            className="min-h-[900px] bg-gray-50 px-8 pb-16 pt-[455px]"
            data-ready={isReady}
            data-testid="configuration-menu-overflow-regression"
        >
            <section className="mx-auto max-w-xl space-y-4 rounded-lg border bg-white p-5 shadow-sm">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">表达式条件 Select</label>
                    <Select value={selectValue} onValueChange={setSelectValue}>
                        <SelectTrigger data-testid="overflow-select-trigger" className="h-9">
                            <SelectValue placeholder="选择条件选项" />
                        </SelectTrigger>
                        <SelectContent data-testid="overflow-select-content">
                            {options.map((option) => (
                                <SelectItem
                                    key={option.id}
                                    value={option.id}
                                    data-testid={`overflow-select-item-${option.id}`}
                                >
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <div data-testid="overflow-select-output" className="text-xs text-gray-500">
                        {selectedSelectOption?.label || '未选择'}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">插件条件 Dropdown</label>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                data-testid="overflow-dropdown-trigger"
                                className="w-full justify-start"
                            >
                                <Puzzle className="mr-2 h-4 w-4" />
                                {dropdownValue || '选择插件条件'}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="start"
                            className="w-72"
                            data-testid="overflow-dropdown-content"
                        >
                            {options.map((option) => (
                                <DropdownMenuItem
                                    key={option.id}
                                    data-testid={`overflow-dropdown-item-${option.id}`}
                                    className="flex flex-col items-start gap-0.5"
                                    onClick={() => setDropdownValue(option.label)}
                                >
                                    <span className="font-medium">{option.label}</span>
                                    <span className="text-xs text-muted-foreground">{option.description}</span>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <div data-testid="overflow-dropdown-output" className="text-xs text-gray-500">
                        {dropdownValue || '未选择'}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">字段建议</label>
                    <FieldSelectorWithPreview
                        value={fieldValue}
                        onChange={setFieldValue}
                        placeholder="选择字段"
                        testData={testData}
                    />
                    <div data-testid="overflow-field-output" className="text-xs text-gray-500">
                        {fieldValue || '未选择'}
                    </div>
                </div>
            </section>
        </main>
    )
}
