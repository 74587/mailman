'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Zap } from 'lucide-react'
import * as HoverCard from '@radix-ui/react-hover-card'

interface FieldSelectorWithPreviewProps {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    testData: Record<string, any>
    disabled?: boolean
    className?: string
}

// 递归提取JSON对象中的所有字段路径（包括数组字段本身）
function extractFieldPaths(obj: any, prefix: string = '', paths: Set<string> = new Set()): string[] {
    if (obj === null || obj === undefined) return Array.from(paths)

    if (typeof obj === 'object' && !Array.isArray(obj)) {
        Object.keys(obj).forEach(key => {
            const currentPath = prefix ? `${prefix}.${key}` : key
            paths.add(currentPath)
            extractFieldPaths(obj[key], currentPath, paths)
        })
    } else if (Array.isArray(obj)) {
        // 数组本身已经被父级添加，这里分析数组元素的结构（如果是对象数组）
        if (obj.length > 0) {
            const firstElement = obj[0]
            if (typeof firstElement === 'object' && firstElement !== null && !Array.isArray(firstElement)) {
                Object.keys(firstElement).forEach(key => {
                    const currentPath = prefix ? `${prefix}[*].${key}` : `[*].${key}`
                    paths.add(currentPath)
                    extractFieldPaths(firstElement[key], currentPath, paths)
                })
            }
        }
    }

    return Array.from(paths)
}

// 通过路径获取值
function getValueByPath(obj: any, path: string): any {
    const parts = path.split('.')
    let value = obj
    for (const part of parts) {
        if (value === undefined || value === null) return undefined
        value = value[part]
    }
    return value
}

// 格式化值用于预览
function formatValueForPreview(value: any): string {
    if (value === undefined) return '(不存在)'
    if (value === null) return 'null'
    if (typeof value === 'string') {
        if (value.length > 30) return `"${value.substring(0, 30)}..."`
        return `"${value}"`
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (typeof value === 'number') return String(value)
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]'
        return `[${value.length}项]`
    }
    if (typeof value === 'object') return '{对象}'
    return String(value)
}

// 获取值的类型和标签样式
function getValueTypeInfo(value: any): { type: string; color: string; bgColor: string } {
    if (value === undefined) return { type: 'undefined', color: 'text-gray-400', bgColor: 'bg-gray-700' }
    if (value === null) return { type: 'null', color: 'text-gray-300', bgColor: 'bg-gray-600' }
    if (typeof value === 'string') return { type: 'string', color: 'text-green-300', bgColor: 'bg-green-900/50' }
    if (typeof value === 'number') return { type: 'number', color: 'text-blue-300', bgColor: 'bg-blue-900/50' }
    if (typeof value === 'boolean') return { type: 'boolean', color: 'text-purple-300', bgColor: 'bg-purple-900/50' }
    if (Array.isArray(value)) return { type: `array[${value.length}]`, color: 'text-amber-300', bgColor: 'bg-amber-900/50' }
    if (typeof value === 'object') return { type: 'object', color: 'text-cyan-300', bgColor: 'bg-cyan-900/50' }
    return { type: typeof value, color: 'text-gray-300', bgColor: 'bg-gray-700' }
}

// 单个字段选项组件 - 使用 HoverCard
function FieldOption({
    path,
    testData,
    isHovered,
    onClick,
    onHover,
    onLeave
}: {
    path: string
    testData: Record<string, any>
    isHovered: boolean
    onClick: () => void
    onHover: () => void
    onLeave: () => void
}) {
    const pathValue = getValueByPath(testData, path)
    const previewText = formatValueForPreview(pathValue)
    const valueExists = pathValue !== undefined

    return (
        <HoverCard.Root openDelay={100} closeDelay={50}>
            <HoverCard.Trigger asChild>
                <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between transition-colors ${isHovered ? 'bg-blue-100' : 'hover:bg-blue-50'
                        }`}
                    onClick={onClick}
                    onMouseEnter={onHover}
                    onMouseLeave={onLeave}
                >
                    <span className="font-mono text-gray-800 text-xs">{path}</span>
                    <span className={`text-xs truncate max-w-[80px] ml-2 ${valueExists ? 'text-green-600' : 'text-gray-400'
                        }`}>
                        {previewText}
                    </span>
                </button>
            </HoverCard.Trigger>
            <HoverCard.Portal>
                <HoverCard.Content
                    className="bg-gray-900 text-white rounded-lg shadow-xl p-3 w-[260px] z-[200] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
                    side="right"
                    align="start"
                    sideOffset={8}
                >
                    {(() => {
                        const typeInfo = getValueTypeInfo(pathValue)
                        return (
                            <>
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs text-gray-400">字段值预览</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeInfo.bgColor} ${typeInfo.color} font-medium`}>
                                        {typeInfo.type}
                                    </span>
                                </div>
                                <div className="font-mono text-xs text-blue-300 mb-2 break-all">{path}</div>
                                <div className="bg-gray-800 rounded p-2 max-h-40 overflow-y-auto">
                                    {valueExists ? (
                                        <pre className="text-xs text-green-300 whitespace-pre-wrap break-all">
                                            {typeof pathValue === 'object'
                                                ? JSON.stringify(pathValue, null, 2)
                                                : String(pathValue)
                                            }
                                        </pre>
                                    ) : (
                                        <span className="text-xs text-amber-400">⚠️ 该字段在测试数据中不存在</span>
                                    )}
                                </div>
                            </>
                        )
                    })()}
                    <HoverCard.Arrow className="fill-gray-900" />
                </HoverCard.Content>
            </HoverCard.Portal>
        </HoverCard.Root>
    )
}

export function FieldSelectorWithPreview({
    value,
    onChange,
    placeholder = '选择字段',
    testData,
    disabled = false,
    className = ''
}: FieldSelectorWithPreviewProps) {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    // 获取所有字段路径
    const fieldPaths = extractFieldPaths(testData)

    // 过滤匹配当前输入的路径
    const filteredPaths = value
        ? fieldPaths.filter(path => path.toLowerCase().includes(value.toLowerCase()))
        : fieldPaths

    // 点击外部关闭下拉菜单
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsDropdownOpen(false)
                setHoveredIndex(null)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    return (
        <div ref={containerRef} className={`relative ${className}`}>
            <div className="flex gap-1">
                <Input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="h-8 text-sm flex-1"
                    disabled={disabled}
                    onFocus={() => setIsDropdownOpen(true)}
                />

                {fieldPaths.length > 0 && (
                    <button
                        ref={buttonRef}
                        type="button"
                        className="h-8 w-8 rounded-md bg-blue-500 text-white text-xs flex items-center justify-center hover:bg-blue-600 transition-colors flex-none"
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setIsDropdownOpen(!isDropdownOpen)
                        }}
                        title="显示可用字段"
                    >
                        <Zap className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* 下拉菜单 */}
            {isDropdownOpen && filteredPaths.length > 0 && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl min-w-[280px] max-h-[400px] overflow-y-auto">
                    <div className="p-2 border-b bg-gray-50 text-xs text-gray-500 font-medium sticky top-0 z-10">
                        可用字段 ({filteredPaths.length})
                    </div>
                    <div className="py-1">
                        {filteredPaths.map((path, index) => (
                            <FieldOption
                                key={path}
                                path={path}
                                testData={testData}
                                isHovered={hoveredIndex === index}
                                onClick={() => {
                                    onChange(path)
                                    setIsDropdownOpen(false)
                                }}
                                onHover={() => setHoveredIndex(index)}
                                onLeave={() => setHoveredIndex(null)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
