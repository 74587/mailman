/**
 * 通用类型定义
 * 用于动作、过滤器和条件分支等组件
 */

// 通用描述信息接口 - 所有可描述的组件都应该包含这个
export interface Describable {
    /** 用户自定义的描述/标签，用于在折叠状态下快速了解组件功能 */
    description?: string
    /** AI 自动生成的描述（如果有） */
    autoDescription?: string
}

// 动作接口
export interface Action extends Describable {
    id: string
    pluginId: string
    pluginName: string
    config: Record<string, any>
    enabled: boolean
    executionOrder: number
    /** 动作别名，用于在结果变量中引用 */
    alias?: string
}

// 条件接口
export interface Condition extends Describable {
    id: string
    type: 'condition' | 'plugin' | 'expression' | 'group'
    // 对于 type === 'condition'
    field?: string
    operator?: string
    value?: string
    // 对于 type === 'plugin' 或 'expression'
    pluginId?: string
    fields?: Record<string, any>
    not?: boolean
    // 对于 type === 'group'
    conditions?: Condition[]
}

// 条件组接口
export interface ConditionGroup extends Describable {
    id: string
    type: 'group'
    operator: 'and' | 'or' | 'not'
    conditions: (Condition | ConditionGroup)[]
}

// 条件分支接口
export interface ConditionalBranch extends Describable {
    id: string
    name: string
    conditions: any[]
    actions: Action[]
    collapsed: boolean
}

// 条件分支配置接口
export interface ConditionalBranchConfig {
    branches: ConditionalBranch[]
    else_actions: Action[]
    return_first_match: boolean
}

// 并行动作配置接口
export interface ParallelActionsConfig extends Describable {
    actions: Action[]
    timeout?: number
    fail_fast?: boolean
    ignore_errors?: boolean
}

// 获取描述信息的工具函数
export function getDescription(item: Describable): string | undefined {
    return item.description || item.autoDescription
}

// 设置描述信息的工具函数
export function setDescription(item: Describable, description: string): Describable {
    return { ...item, description }
}

// 判断是否有描述信息
export function hasDescription(item: Describable): boolean {
    return !!(item.description || item.autoDescription)
}
