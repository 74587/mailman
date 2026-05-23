'use client'

import React, { useRef, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

// Language configuration for different expression engines
export type EditorLanguage = 'javascript' | 'go-template' | 'cel' | 'jsonpath' | 'json'

interface CodeEditorProps {
    value: string
    onChange: (value: string) => void
    language?: EditorLanguage
    placeholder?: string
    className?: string
    minHeight?: number
    maxHeight?: number
    readOnly?: boolean
    onValidate?: (isValid: boolean, error?: string) => void
    syntaxHelp?: string
    examples?: Array<{ title: string; expression: string }>
}

// Simple syntax highlighting for different languages
const getHighlightedCode = (code: string, language: EditorLanguage): React.ReactNode => {
    if (!code) return null

    // Simple token-based highlighting
    const patterns: Record<EditorLanguage, Array<{ pattern: RegExp; className: string }>> = {
        javascript: [
            { pattern: /\/\/.*$/gm, className: 'text-gray-500' }, // comments
            { pattern: /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, className: 'text-green-600' }, // strings
            { pattern: /\b(true|false|null|undefined)\b/g, className: 'text-purple-600' }, // literals
            { pattern: /\b(if|else|return|function|const|let|var|for|while|do|switch|case|break|continue|try|catch|throw|new|typeof|instanceof)\b/g, className: 'text-blue-600' }, // keywords
            { pattern: /\b(\d+\.?\d*)\b/g, className: 'text-orange-600' }, // numbers
            { pattern: /\.(includes|startsWith|endsWith|toLowerCase|toUpperCase|trim|split|match|replace|some|every|filter|map|find|length)\b/g, className: 'text-cyan-600' }, // methods
        ],
        'go-template': [
            { pattern: /\{\{\/\*.*?\*\/\}\}/gs, className: 'text-gray-500' }, // comments
            { pattern: /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, className: 'text-green-600' }, // strings
            { pattern: /\{\{|\}\}/g, className: 'text-purple-600' }, // delimiters
            { pattern: /\b(if|else|end|range|with|define|template|block)\b/g, className: 'text-blue-600' }, // keywords
            { pattern: /\.\w+/g, className: 'text-cyan-600' }, // fields
            { pattern: /\b(and|or|not|eq|ne|lt|le|gt|ge|len|contains|hasPrefix|hasSuffix)\b/g, className: 'text-yellow-600' }, // functions
        ],
        cel: [
            { pattern: /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, className: 'text-green-600' }, // strings
            { pattern: /\b(true|false|null)\b/g, className: 'text-purple-600' }, // literals
            { pattern: /\b(in|has)\b/g, className: 'text-blue-600' }, // keywords
            { pattern: /\b(\d+\.?\d*)\b/g, className: 'text-orange-600' }, // numbers
            { pattern: /\.(contains|startsWith|endsWith|matches|size|all|exists|filter|map)\b/g, className: 'text-cyan-600' }, // methods
            { pattern: /&&|\|\||!|==|!=|<=|>=|<|>|\?|:/g, className: 'text-red-600' }, // operators
        ],
        jsonpath: [
            { pattern: /\$\./g, className: 'text-purple-600' }, // root
            { pattern: /\[.*?\]/g, className: 'text-blue-600' }, // brackets
            { pattern: /\.\w+/g, className: 'text-cyan-600' }, // fields
            { pattern: /\?\(@.*?\)/g, className: 'text-green-600' }, // filters
            { pattern: /==|!=|>|<|>=|<=|=~/g, className: 'text-red-600' }, // operators
            { pattern: /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, className: 'text-green-600' }, // strings
        ],
        json: [
            { pattern: /(["'])(?:(?!\1)[^\\]|\\.)*\1(?=\s*:)/g, className: 'text-blue-600' }, // keys
            { pattern: /(["'])(?:(?!\1)[^\\]|\\.)*\1/g, className: 'text-green-600' }, // string values
            { pattern: /\b(true|false|null)\b/g, className: 'text-purple-600' }, // literals
            { pattern: /\b(-?\d+\.?\d*)\b/g, className: 'text-orange-600' }, // numbers
        ],
    }

    // For now, return plain text with basic styling
    // A full implementation would tokenize and apply styles
    return <span className="font-mono text-sm">{code}</span>
}

export function CodeEditor({
    value,
    onChange,
    language = 'javascript',
    placeholder = 'Enter expression...',
    className,
    minHeight = 80,
    maxHeight = 300,
    readOnly = false,
    onValidate,
    syntaxHelp,
    examples = []
}: CodeEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const [isFocused, setIsFocused] = useState(false)
    const [showExamples, setShowExamples] = useState(false)

    // Auto-resize textarea
    useEffect(() => {
        const textarea = textareaRef.current
        if (textarea) {
            textarea.style.height = 'auto'
            const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)
            textarea.style.height = `${newHeight}px`
        }
    }, [value, minHeight, maxHeight])

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value
        onChange(newValue)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Handle Tab key for indentation
        if (e.key === 'Tab') {
            e.preventDefault()
            const textarea = e.currentTarget
            const start = textarea.selectionStart
            const end = textarea.selectionEnd
            const newValue = value.substring(0, start) + '  ' + value.substring(end)
            onChange(newValue)
            // Set cursor position after the inserted spaces
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = start + 2
            }, 0)
        }
    }

    const insertExample = (expression: string) => {
        onChange(expression)
        setShowExamples(false)
        textareaRef.current?.focus()
    }

    // Language-specific placeholder
    const getPlaceholder = () => {
        switch (language) {
            case 'javascript':
                return 'Subject.includes("urgent") && From.some(addr => addr.endsWith("@company.com"))'
            case 'go-template':
                return '{{ if contains .Subject "urgent" }}true{{ else }}false{{ end }}'
            case 'cel':
                return 'Subject.contains("urgent") && size(Attachments) > 0'
            case 'jsonpath':
                return '$.Subject =~ "urgent"'
            default:
                return placeholder
        }
    }

    return (
        <div className={cn('relative', className)}>
            {/* Editor container */}
            <div
                className={cn(
                    'relative rounded-md border transition-colors',
                    isFocused ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300',
                    readOnly && 'bg-gray-50'
                )}
            >
                {/* Language badge */}
                <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
                    <span className="px-1.5 py-0.5 text-xs font-medium text-gray-500 bg-gray-100 rounded">
                        {language}
                    </span>
                    {examples.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowExamples(!showExamples)}
                            className="px-1.5 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                        >
                            Examples
                        </button>
                    )}
                </div>

                {/* Textarea */}
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder={getPlaceholder()}
                    readOnly={readOnly}
                    spellCheck={false}
                    className={cn(
                        'w-full p-3 pr-20 font-mono text-sm bg-transparent resize-none focus:outline-none',
                        'placeholder:text-gray-400'
                    )}
                    style={{ minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` }}
                />
            </div>

            {/* Examples dropdown */}
            {showExamples && examples.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
                    {examples.map((example, index) => (
                        <button
                            key={index}
                            type="button"
                            onClick={() => insertExample(example.expression)}
                            className="w-full px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100 last:border-0"
                        >
                            <div className="text-sm font-medium text-gray-900">{example.title}</div>
                            <div className="text-xs font-mono text-gray-500 truncate mt-0.5">
                                {example.expression}
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {/* Syntax help */}
            {syntaxHelp && isFocused && (
                <div className="mt-1 p-2 text-xs text-gray-600 bg-gray-50 rounded border border-gray-200">
                    {syntaxHelp}
                </div>
            )}
        </div>
    )
}

export default CodeEditor
