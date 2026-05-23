'use client'
import { logger } from '@/lib/logger';

import { loader } from '@monaco-editor/react'

// Configure Monaco to use the local npm package instead of CDN
// This significantly improves first-load performance
let configured = false

export function configureMonaco() {
    if (configured) return
    configured = true

    // Configure the loader to use local Monaco files from node_modules
    // This avoids CDN network requests while preventing Terser issues with direct imports
    loader.config({
        paths: {
            vs: '/monaco-editor/min/vs'
        }
    })

    logger.debug('[Monaco] Configured to use local package (no CDN)')
}

// Helper to generate type definitions from a data object
export interface TypeInfo {
    name: string
    type: string
    children?: TypeInfo[]
    isArray?: boolean
}

// Infer TypeScript-like type string from a value
function inferType(value: any): string {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (Array.isArray(value)) {
        if (value.length === 0) return 'any[]'
        const itemType = inferType(value[0])
        return `${itemType}[]`
    }
    if (typeof value === 'object') {
        return 'object'
    }
    return typeof value
}

// Generate field info from data object for autocomplete
export function generateFieldsFromData(data: any, prefix: string = ''): TypeInfo[] {
    if (!data || typeof data !== 'object') return []

    const fields: TypeInfo[] = []

    for (const [key, value] of Object.entries(data)) {
        const fullPath = prefix ? `${prefix}.${key}` : key
        const type = inferType(value)
        const isArray = Array.isArray(value)

        const field: TypeInfo = {
            name: key,
            type,
            isArray,
        }

        // For objects and arrays with object items, add nested fields
        if (typeof value === 'object' && value !== null) {
            if (isArray && value.length > 0 && typeof value[0] === 'object') {
                field.children = generateFieldsFromData(value[0], '')
            } else if (!isArray) {
                field.children = generateFieldsFromData(value, '')
            }
        }

        fields.push(field)
    }

    return fields
}

// String methods for intellisense
export const STRING_METHODS = [
    { label: 'includes', insertText: 'includes(${1:searchString})', doc: '检查字符串是否包含指定子串', returnType: 'boolean' },
    { label: 'startsWith', insertText: 'startsWith(${1:searchString})', doc: '检查字符串是否以指定子串开头', returnType: 'boolean' },
    { label: 'endsWith', insertText: 'endsWith(${1:searchString})', doc: '检查字符串是否以指定子串结尾', returnType: 'boolean' },
    { label: 'toLowerCase', insertText: 'toLowerCase()', doc: '转换为小写', returnType: 'string' },
    { label: 'toUpperCase', insertText: 'toUpperCase()', doc: '转换为大写', returnType: 'string' },
    { label: 'trim', insertText: 'trim()', doc: '去除首尾空格', returnType: 'string' },
    { label: 'trimStart', insertText: 'trimStart()', doc: '去除开头空格', returnType: 'string' },
    { label: 'trimEnd', insertText: 'trimEnd()', doc: '去除结尾空格', returnType: 'string' },
    { label: 'match', insertText: 'match(/${1:pattern}/)', doc: '正则匹配', returnType: 'RegExpMatchArray | null' },
    { label: 'replace', insertText: 'replace(${1:searchValue}, ${2:replaceValue})', doc: '替换字符串', returnType: 'string' },
    { label: 'replaceAll', insertText: 'replaceAll(${1:searchValue}, ${2:replaceValue})', doc: '替换所有匹配', returnType: 'string' },
    { label: 'split', insertText: 'split(${1:separator})', doc: '分割字符串', returnType: 'string[]' },
    { label: 'substring', insertText: 'substring(${1:start}, ${2:end})', doc: '截取子字符串', returnType: 'string' },
    { label: 'slice', insertText: 'slice(${1:start}, ${2:end})', doc: '截取子字符串', returnType: 'string' },
    { label: 'charAt', insertText: 'charAt(${1:index})', doc: '获取指定位置字符', returnType: 'string' },
    { label: 'charCodeAt', insertText: 'charCodeAt(${1:index})', doc: '获取指定位置字符的 Unicode 编码', returnType: 'number' },
    { label: 'indexOf', insertText: 'indexOf(${1:searchString})', doc: '查找子字符串位置', returnType: 'number' },
    { label: 'lastIndexOf', insertText: 'lastIndexOf(${1:searchString})', doc: '从后往前查找子字符串位置', returnType: 'number' },
    { label: 'length', insertText: 'length', doc: '字符串长度', returnType: 'number' },
    { label: 'padStart', insertText: 'padStart(${1:targetLength}, ${2:padString})', doc: '在开头填充字符', returnType: 'string' },
    { label: 'padEnd', insertText: 'padEnd(${1:targetLength}, ${2:padString})', doc: '在结尾填充字符', returnType: 'string' },
    { label: 'repeat', insertText: 'repeat(${1:count})', doc: '重复字符串', returnType: 'string' },
    { label: 'normalize', insertText: 'normalize()', doc: '规范化 Unicode', returnType: 'string' },
    { label: 'localeCompare', insertText: 'localeCompare(${1:compareString})', doc: '按本地化方式比较字符串', returnType: 'number' },
]

// Array methods for intellisense
export const ARRAY_METHODS = [
    { label: 'some', insertText: 'some(${1:item} => ${2:condition})', doc: '检查是否有任意元素满足条件', returnType: 'boolean' },
    { label: 'every', insertText: 'every(${1:item} => ${2:condition})', doc: '检查是否所有元素都满足条件', returnType: 'boolean' },
    { label: 'filter', insertText: 'filter(${1:item} => ${2:condition})', doc: '过滤满足条件的元素', returnType: 'T[]' },
    { label: 'find', insertText: 'find(${1:item} => ${2:condition})', doc: '查找第一个满足条件的元素', returnType: 'T | undefined' },
    { label: 'findIndex', insertText: 'findIndex(${1:item} => ${2:condition})', doc: '查找第一个满足条件的元素索引', returnType: 'number' },
    { label: 'map', insertText: 'map(${1:item} => ${2:transform})', doc: '映射每个元素', returnType: 'U[]' },
    { label: 'reduce', insertText: 'reduce((${1:acc}, ${2:item}) => ${3:result}, ${4:initialValue})', doc: '归约数组', returnType: 'U' },
    { label: 'reduceRight', insertText: 'reduceRight((${1:acc}, ${2:item}) => ${3:result}, ${4:initialValue})', doc: '从右往左归约数组', returnType: 'U' },
    { label: 'forEach', insertText: 'forEach(${1:item} => ${2:action})', doc: '遍历每个元素', returnType: 'void' },
    { label: 'includes', insertText: 'includes(${1:value})', doc: '检查数组是否包含指定值', returnType: 'boolean' },
    { label: 'indexOf', insertText: 'indexOf(${1:value})', doc: '获取元素索引', returnType: 'number' },
    { label: 'lastIndexOf', insertText: 'lastIndexOf(${1:value})', doc: '从后往前获取元素索引', returnType: 'number' },
    { label: 'join', insertText: 'join(${1:separator})', doc: '连接数组元素为字符串', returnType: 'string' },
    { label: 'concat', insertText: 'concat(${1:items})', doc: '连接数组', returnType: 'T[]' },
    { label: 'slice', insertText: 'slice(${1:start}, ${2:end})', doc: '截取数组', returnType: 'T[]' },
    { label: 'flat', insertText: 'flat(${1:depth})', doc: '扁平化数组', returnType: 'T[]' },
    { label: 'flatMap', insertText: 'flatMap(${1:item} => ${2:transform})', doc: '映射后扁平化', returnType: 'U[]' },
    { label: 'reverse', insertText: 'reverse()', doc: '反转数组', returnType: 'T[]' },
    { label: 'sort', insertText: 'sort((${1:a}, ${2:b}) => ${3:comparison})', doc: '排序数组', returnType: 'T[]' },
    { label: 'length', insertText: 'length', doc: '数组长度', returnType: 'number' },
    { label: 'at', insertText: 'at(${1:index})', doc: '获取指定索引的元素（支持负数）', returnType: 'T | undefined' },
]

// Number methods for intellisense
export const NUMBER_METHODS = [
    { label: 'toFixed', insertText: 'toFixed(${1:digits})', doc: '格式化为固定小数位数', returnType: 'string' },
    { label: 'toPrecision', insertText: 'toPrecision(${1:precision})', doc: '格式化为指定精度', returnType: 'string' },
    { label: 'toExponential', insertText: 'toExponential(${1:fractionDigits})', doc: '转换为指数表示法', returnType: 'string' },
    { label: 'toString', insertText: 'toString(${1:radix})', doc: '转换为字符串', returnType: 'string' },
    { label: 'valueOf', insertText: 'valueOf()', doc: '获取原始值', returnType: 'number' },
]

// Boolean methods for intellisense
export const BOOLEAN_METHODS = [
    { label: 'toString', insertText: 'toString()', doc: '转换为字符串', returnType: 'string' },
    { label: 'valueOf', insertText: 'valueOf()', doc: '获取原始值', returnType: 'boolean' },
]

// Object methods for intellisense
export const OBJECT_METHODS = [
    { label: 'hasOwnProperty', insertText: 'hasOwnProperty(${1:key})', doc: '检查是否有指定属性', returnType: 'boolean' },
    { label: 'toString', insertText: 'toString()', doc: '转换为字符串', returnType: 'string' },
    { label: 'valueOf', insertText: 'valueOf()', doc: '获取原始值', returnType: 'object' },
]

// Get the appropriate methods based on type
export function getMethodsForType(type: string): typeof STRING_METHODS {
    if (type === 'string') return STRING_METHODS
    if (type.endsWith('[]') || type === 'array') return ARRAY_METHODS
    if (type === 'number') return NUMBER_METHODS
    if (type === 'boolean') return BOOLEAN_METHODS
    if (type === 'object') return OBJECT_METHODS
    return []
}
