/**
 * When 条件表达式解析器
 * 支持简单的布尔表达式解析
 * 
 * 支持的语法:
 * - 变量: inputFocused, dialogOpen, activeTab
 * - 比较: activeTab == "dashboard", count > 0
 * - 逻辑: !inputFocused, a && b, a || b
 * - 括号: (a && b) || c
 */

import { KeyboardContext } from './types'

/**
 * Token 类型
 */
type TokenType =
    | 'IDENTIFIER'
    | 'STRING'
    | 'NUMBER'
    | 'BOOLEAN'
    | 'AND'
    | 'OR'
    | 'NOT'
    | 'EQ'
    | 'NEQ'
    | 'GT'
    | 'GTE'
    | 'LT'
    | 'LTE'
    | 'LPAREN'
    | 'RPAREN'
    | 'EOF'

interface Token {
    type: TokenType
    value: string | number | boolean
}

/**
 * 词法分析器
 */
function tokenize(expression: string): Token[] {
    const tokens: Token[] = []
    let pos = 0

    while (pos < expression.length) {
        const char = expression[pos]

        // 跳过空白
        if (/\s/.test(char)) {
            pos++
            continue
        }

        // 字符串
        if (char === '"' || char === "'") {
            const quote = char
            let value = ''
            pos++ // 跳过开始引号
            while (pos < expression.length && expression[pos] !== quote) {
                value += expression[pos]
                pos++
            }
            pos++ // 跳过结束引号
            tokens.push({ type: 'STRING', value })
            continue
        }

        // 数字
        if (/\d/.test(char)) {
            let value = ''
            while (pos < expression.length && /\d/.test(expression[pos])) {
                value += expression[pos]
                pos++
            }
            tokens.push({ type: 'NUMBER', value: parseInt(value, 10) })
            continue
        }

        // 标识符和关键字
        if (/[a-zA-Z_]/.test(char)) {
            let value = ''
            while (pos < expression.length && /[a-zA-Z0-9_]/.test(expression[pos])) {
                value += expression[pos]
                pos++
            }

            if (value === 'true') {
                tokens.push({ type: 'BOOLEAN', value: true })
            } else if (value === 'false') {
                tokens.push({ type: 'BOOLEAN', value: false })
            } else {
                tokens.push({ type: 'IDENTIFIER', value })
            }
            continue
        }

        // 运算符
        if (char === '&' && expression[pos + 1] === '&') {
            tokens.push({ type: 'AND', value: '&&' })
            pos += 2
            continue
        }

        if (char === '|' && expression[pos + 1] === '|') {
            tokens.push({ type: 'OR', value: '||' })
            pos += 2
            continue
        }

        if (char === '!' && expression[pos + 1] === '=') {
            tokens.push({ type: 'NEQ', value: '!=' })
            pos += 2
            continue
        }

        if (char === '!') {
            tokens.push({ type: 'NOT', value: '!' })
            pos++
            continue
        }

        if (char === '=' && expression[pos + 1] === '=') {
            tokens.push({ type: 'EQ', value: '==' })
            pos += 2
            continue
        }

        if (char === '>' && expression[pos + 1] === '=') {
            tokens.push({ type: 'GTE', value: '>=' })
            pos += 2
            continue
        }

        if (char === '>') {
            tokens.push({ type: 'GT', value: '>' })
            pos++
            continue
        }

        if (char === '<' && expression[pos + 1] === '=') {
            tokens.push({ type: 'LTE', value: '<=' })
            pos += 2
            continue
        }

        if (char === '<') {
            tokens.push({ type: 'LT', value: '<' })
            pos++
            continue
        }

        if (char === '(') {
            tokens.push({ type: 'LPAREN', value: '(' })
            pos++
            continue
        }

        if (char === ')') {
            tokens.push({ type: 'RPAREN', value: ')' })
            pos++
            continue
        }

        // 未知字符，跳过
        pos++
    }

    tokens.push({ type: 'EOF', value: '' })
    return tokens
}

/**
 * 语法分析器（递归下降）
 */
class Parser {
    private tokens: Token[]
    private pos: number = 0
    private context: KeyboardContext

    constructor(tokens: Token[], context: KeyboardContext) {
        this.tokens = tokens
        this.context = context
    }

    private current(): Token {
        return this.tokens[this.pos] || { type: 'EOF', value: '' }
    }

    private consume(): Token {
        return this.tokens[this.pos++]
    }

    private expect(type: TokenType): Token {
        const token = this.consume()
        if (token.type !== type) {
            throw new Error(`Expected ${type}, got ${token.type}`)
        }
        return token
    }

    /**
     * 解析表达式
     */
    parse(): boolean {
        return this.parseOr()
    }

    /**
     * 解析 OR 表达式
     */
    private parseOr(): boolean {
        let left = this.parseAnd()

        while (this.current().type === 'OR') {
            this.consume()
            const right = this.parseAnd()
            left = left || right
        }

        return left
    }

    /**
     * 解析 AND 表达式
     */
    private parseAnd(): boolean {
        let left = this.parseNot()

        while (this.current().type === 'AND') {
            this.consume()
            const right = this.parseNot()
            left = left && right
        }

        return left
    }

    /**
     * 解析 NOT 表达式
     */
    private parseNot(): boolean {
        if (this.current().type === 'NOT') {
            this.consume()
            return !this.parseNot()
        }

        return this.parseComparison()
    }

    /**
     * 解析比较表达式
     */
    private parseComparison(): boolean {
        const left = this.parsePrimary()

        const opToken = this.current()
        if (['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE'].includes(opToken.type)) {
            this.consume()
            const right = this.parsePrimary()

            switch (opToken.type) {
                case 'EQ': return left === right
                case 'NEQ': return left !== right
                case 'GT': return (left as number) > (right as number)
                case 'GTE': return (left as number) >= (right as number)
                case 'LT': return (left as number) < (right as number)
                case 'LTE': return (left as number) <= (right as number)
            }
        }

        // 如果是布尔值，直接返回
        return !!left
    }

    /**
     * 解析基本表达式
     */
    private parsePrimary(): unknown {
        const token = this.current()

        switch (token.type) {
            case 'LPAREN': {
                this.consume()
                const result = this.parseOr()
                this.expect('RPAREN')
                return result
            }

            case 'IDENTIFIER': {
                this.consume()
                const name = token.value as string
                return this.context[name]
            }

            case 'STRING':
            case 'NUMBER':
            case 'BOOLEAN': {
                this.consume()
                return token.value
            }

            default:
                return false
        }
    }
}

/**
 * 评估 when 条件表达式
 * 
 * @param expression - when 条件表达式
 * @param context - 键盘上下文
 * @returns 表达式结果
 */
export function evaluateWhen(expression: string | undefined, context: KeyboardContext): boolean {
    // 无条件表达式时，默认返回 true
    if (!expression || expression.trim() === '') {
        return true
    }

    try {
        const tokens = tokenize(expression)
        const parser = new Parser(tokens, context)
        return parser.parse()
    } catch (error) {
        console.warn(`[WhenEvaluator] Failed to evaluate expression: "${expression}"`, error)
        return false
    }
}
