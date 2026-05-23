/**
 * AI 自动描述生成服务
 * 根据配置内容智能生成描述信息
 */

// 操作符的中文映射
const OPERATOR_MAP: Record<string, string> = {
    equals: '等于',
    not_equals: '不等于',
    contains: '包含',
    not_contains: '不包含',
    starts_with: '开头是',
    ends_with: '结尾是',
    matches: '匹配',
    greater_than: '大于',
    less_than: '小于',
    is_empty: '为空',
    is_not_empty: '非空',
    in: '在列表中',
    not_in: '不在列表中'
}

// 字段的中文映射
const FIELD_MAP: Record<string, string> = {
    subject: '主题',
    from: '发件人',
    to: '收件人',
    cc: '抄送',
    bcc: '密送',
    textContent: '正文',
    body: '内容',
    date: '日期',
    attachmentCount: '附件数',
    size: '大小',
    labels: '标签',
    sender: '发送者',
    recipient: '接收者'
}

// 动作类型的中文映射
const ACTION_MAP: Record<string, string> = {
    email_forward_action: '转发邮件',
    email_label_action: '添加标签',
    email_delete_action: '删除邮件',
    email_transform_action: '修改内容',
    email_archive_action: '归档邮件',
    email_mark_read_action: '标记已读',
    email_move_action: '移动邮件',
    telegram_bot_action: '发送 Telegram',
    webhook_action: '调用 Webhook',
    conditional_branch_action: '条件分支',
    parallel_actions: '并行执行',
    variable_extract_action: '提取变量',
    email_reply_action: '回复邮件',
    script_action: '执行脚本'
}

/**
 * 生成条件的描述
 */
export function generateConditionDescription(condition: any): string {
    if (!condition) return ''

    // 条件组
    if (condition.type === 'group') {
        const operator = condition.operator === 'and' ? '全部满足' :
            condition.operator === 'or' ? '任一满足' : '取反'
        const count = condition.conditions?.length || 0
        if (count === 0) return `${operator}(空)`
        return `${count}个条件${operator}`
    }

    // 普通条件
    if (condition.type === 'condition') {
        const field = FIELD_MAP[condition.field] || condition.field || '字段'
        const operator = OPERATOR_MAP[condition.operator] || condition.operator || '='
        const value = condition.value?.toString()?.slice(0, 20) || ''
        const valueDisplay = value.length > 20 ? value + '...' : value
        return `${field} ${operator} "${valueDisplay}"`
    }

    // 表达式条件
    if (condition.type === 'expression') {
        const engineMap: Record<string, string> = {
            'expr.javascript': 'JS表达式',
            'expr.cel': 'CEL表达式',
            'expr.go_template': 'Go模板',
            'expr.jsonpath': 'JSONPath'
        }
        const engine = engineMap[condition.pluginId] || '表达式'
        const expr = condition.fields?.expression?.slice(0, 30) || ''
        return expr ? `${engine}: ${expr}${expr.length > 30 ? '...' : ''}` : engine
    }

    // 插件条件
    if (condition.type === 'plugin') {
        return `插件: ${condition.pluginId || '未知'}`
    }

    return '未知条件'
}

/**
 * 生成动作的描述
 */
export function generateActionDescription(action: any): string {
    if (!action) return ''

    const { pluginId, config } = action
    const baseDesc = ACTION_MAP[pluginId] || pluginId || '动作'

    switch (pluginId) {
        case 'email_forward_action':
            return config?.to_address
                ? `转发至 ${config.to_address}`
                : '转发邮件'

        case 'email_label_action':
            const operation = config?.operation === 'add' ? '添加' : '移除'
            const labels = config?.labels?.join(', ') || ''
            return labels ? `${operation}标签: ${labels}` : '管理标签'

        case 'email_delete_action':
            return config?.permanent ? '永久删除邮件' : '移至回收站'

        case 'email_transform_action':
            const field = FIELD_MAP[config?.target_field] || config?.target_field || '内容'
            return `修改${field}`

        case 'telegram_bot_action':
            return config?.chat_id
                ? `发送到 Telegram (${config.chat_id})`
                : '发送 Telegram 消息'

        case 'webhook_action':
            const url = config?.url || ''
            if (url) {
                try {
                    const hostname = new URL(url).hostname
                    return `调用 ${hostname}`
                } catch {
                    return `调用 Webhook`
                }
            }
            return '调用 Webhook'

        case 'conditional_branch_action':
            const branchCount = config?.branches?.length || 0
            return `${branchCount}个条件分支`

        case 'parallel_actions':
            const actionCount = config?.actions?.length || 0
            return `并行${actionCount}个动作`

        case 'variable_extract_action':
            const extractCount = config?.extractions?.length || 0
            return `提取${extractCount}个变量`

        default:
            return baseDesc
    }
}

/**
 * 生成条件分支的描述
 */
export function generateBranchDescription(branch: any): string {
    if (!branch) return ''

    const conditions = branch.conditions || []
    const actions = branch.actions || []

    // 分析条件
    let condDesc = ''
    if (conditions.length > 0) {
        const rootGroup = conditions[0]
        if (rootGroup?.type === 'group' && rootGroup.conditions?.length > 0) {
            const firstCond = rootGroup.conditions[0]
            condDesc = generateConditionDescription(firstCond)
            if (rootGroup.conditions.length > 1) {
                condDesc += ` 等${rootGroup.conditions.length}个条件`
            }
        }
    }

    // 分析动作
    let actDesc = ''
    if (actions.length > 0) {
        actDesc = generateActionDescription(actions[0])
        if (actions.length > 1) {
            actDesc += ` 等${actions.length}个动作`
        }
    }

    // 组合描述
    if (condDesc && actDesc) {
        return `当${condDesc}时，${actDesc}`
    } else if (condDesc) {
        return `当${condDesc}时`
    } else if (actDesc) {
        return actDesc
    }

    return ''
}

/**
 * 生成过滤器组的描述
 */
export function generateFilterGroupDescription(group: any): string {
    if (!group || group.type !== 'group') return ''

    const conditions = group.conditions || []
    if (conditions.length === 0) return '无条件'

    const operator = group.operator === 'and' ? '且' :
        group.operator === 'or' ? '或' : '非'

    // 取前两个条件生成描述
    const descs = conditions.slice(0, 2).map((c: any) => {
        if (c.type === 'group') {
            return `(${generateFilterGroupDescription(c)})`
        }
        return generateConditionDescription(c)
    })

    let result = descs.join(` ${operator} `)
    if (conditions.length > 2) {
        result += ` 等${conditions.length}个条件`
    }

    return result
}

/**
 * 为配置生成智能摘要
 */
export function generateSmartSummary(config: {
    expressions?: any[]
    actions?: any[]
    branches?: any[]
}): string {
    const parts: string[] = []

    // 分析过滤条件
    if (config.expressions && config.expressions.length > 0) {
        const rootGroup = config.expressions[0]
        if (rootGroup) {
            parts.push(`过滤: ${generateFilterGroupDescription(rootGroup)}`)
        }
    }

    // 分析动作
    if (config.actions && config.actions.length > 0) {
        const actionDescs = config.actions.slice(0, 2).map(generateActionDescription)
        let actionPart = actionDescs.join(' → ')
        if (config.actions.length > 2) {
            actionPart += ` 等${config.actions.length}步`
        }
        parts.push(`动作: ${actionPart}`)
    }

    // 分析分支
    if (config.branches && config.branches.length > 0) {
        parts.push(`${config.branches.length}个条件分支`)
    }

    return parts.join(' | ')
}

/**
 * AI 描述服务接口
 */
export const aiDescriptionService = {
    /**
     * 为条件生成描述
     */
    forCondition: generateConditionDescription,

    /**
     * 为动作生成描述
     */
    forAction: generateActionDescription,

    /**
     * 为分支生成描述
     */
    forBranch: generateBranchDescription,

    /**
     * 为过滤器组生成描述
     */
    forFilterGroup: generateFilterGroupDescription,

    /**
     * 生成智能摘要
     */
    smartSummary: generateSmartSummary,

    /**
     * 批量为动作生成描述
     */
    forActions: (actions: any[]): Map<string, string> => {
        const result = new Map<string, string>()
        actions.forEach(action => {
            if (action.id) {
                result.set(action.id, generateActionDescription(action))
            }
        })
        return result
    },

    /**
     * 批量为条件生成描述
     */
    forConditions: (conditions: any[]): Map<string, string> => {
        const result = new Map<string, string>()
        const processCondition = (condition: any) => {
            if (condition.id) {
                result.set(condition.id, generateConditionDescription(condition))
            }
            if (condition.conditions) {
                condition.conditions.forEach(processCondition)
            }
        }
        conditions.forEach(processCondition)
        return result
    }
}

export default aiDescriptionService
