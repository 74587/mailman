import { v4 as uuidv4 } from 'uuid'
import { TriggerExpression } from '@/types'

// 将表达式转换为JSON字符串
export const expressionsToJson = (expressions: TriggerExpression[]): string => {
  return JSON.stringify(expressions, null, 2)
}

// 尝试从JSON字符串解析表达式
export const jsonToExpressions = (json: string): TriggerExpression[] | null => {
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) {
      return parsed
    }
    return null
  } catch (error) {
    console.error('解析JSON失败:', error)
    return null
  }
}

// 将表达式转换为可读的文本描述
export const expressionsToText = (expressions: TriggerExpression[]): string => {
  if (!expressions || expressions.length === 0) {
    return '无条件'
  }

  return expressions.map(expr => expressionToText(expr)).join(' 且 ')
}

// 将单个表达式转换为可读的文本描述
export const expressionToText = (expression: TriggerExpression): string => {
  if (expression.type === 'condition') {
    let text = ''

    // 字段
    if (expression.field) {
      text += getFieldDisplayName(expression.field)
    }

    // 操作符
    if (expression.operator) {
      text += ' ' + getOperatorDisplayName(expression.operator)
    }

    // 值
    if (expression.value !== undefined && expression.value !== null) {
      text += ' "' + expression.value + '"'
    }

    // 取反
    if (expression.not) {
      text = '不(' + text + ')'
    }

    return text
  } else if (expression.type === 'group') {
    if (!expression.conditions || expression.conditions.length === 0) {
      return '空组'
    }

    const conditionsText = expression.conditions.map(expr => expressionToText(expr))
    let text = ''

    if (expression.operator === 'and') {
      text = conditionsText.join(' 且 ')
    } else if (expression.operator === 'or') {
      text = conditionsText.join(' 或 ')
    } else if (expression.operator === 'not') {
      text = '非(' + conditionsText.join(' 且 ') + ')'
    }

    // 取反
    if (expression.not) {
      text = '不(' + text + ')'
    }

    return text
  }

  return '未知表达式'
}

// 获取字段显示名称
export const getFieldDisplayName = (field: string): string => {
  const fieldMap: Record<string, string> = {
    'subject': '邮件主题',
    'from': '发件人',
    'to': '收件人',
    'cc': '抄送',
    'bcc': '密送',
    'body': '邮件内容',
    'htmlBody': 'HTML内容',
    'textBody': '纯文本内容',
    'hasAttachments': '有附件',
    'date': '日期',
    'receivedAt': '接收时间',
    'messageId': '消息ID'
  }

  return fieldMap[field] || field
}

// 获取操作符显示名称
export const getOperatorDisplayName = (operator: string): string => {
  const operatorMap: Record<string, string> = {
    'equals': '等于',
    'not_equals': '不等于',
    'contains': '包含',
    'not_contains': '不包含',
    'starts_with': '开头是',
    'ends_with': '结尾是',
    'matches': '匹配',
    'greater_than': '大于',
    'less_than': '小于',
    'greater_equal': '大于等于',
    'less_equal': '小于等于',
    'in': '在列表中',
    'not_in': '不在列表中'
  }

  return operatorMap[operator] || operator
}

// 将表达式转换为后端API格式
export const expressionsToApiFormat = (expressions: TriggerExpression[]): any[] => {
  return expressions.map(expr => expressionToApiFormat(expr))
}

// 将单个表达式转换为后端API格式
export const expressionToApiFormat = (expression: TriggerExpression): any => {
  if (expression.type === 'condition') {
    return {
      id: expression.id,
      type: expression.type,
      field: expression.field,
      operator: expression.operator,
      value: expression.value,
      not: expression.not
    }
  } else if (expression.type === 'group') {
    return {
      id: expression.id,
      type: expression.type,
      operator: expression.operator,
      conditions: expression.conditions?.map(expr => expressionToApiFormat(expr)) || [],
      not: expression.not
    }
  }

  return expression
}

// 从后端API格式转换为表达式
export const apiFormatToExpressions = (apiData: any[]): TriggerExpression[] => {
  return apiData.map(item => apiFormatToExpression(item))
}

// 从后端API格式转换为单个表达式
export const apiFormatToExpression = (apiData: any): TriggerExpression => {
  if (!apiData.id) {
    apiData.id = uuidv4()
  }

  if (apiData.type === 'condition') {
    return {
      id: apiData.id,
      type: apiData.type,
      field: apiData.field,
      operator: apiData.operator,
      value: apiData.value,
      not: apiData.not
    } as TriggerExpression
  } else if (apiData.type === 'group') {
    return {
      id: apiData.id,
      type: apiData.type,
      operator: apiData.operator,
      conditions: apiData.conditions?.map((item: any) => apiFormatToExpression(item)) || [],
      not: apiData.not
    } as TriggerExpression
  }

  return apiData as TriggerExpression
}

// 验证表达式是否有效
export const validateExpression = (expression: TriggerExpression): boolean => {
  if (expression.type === 'condition') {
    return !!expression.field && !!expression.operator
  } else if (expression.type === 'group') {
    return !!expression.operator &&
      !!expression.conditions &&
      expression.conditions.length > 0 &&
      expression.conditions.every(expr => validateExpression(expr))
  }

  return false
}

// 验证表达式数组是否有效
export const validateExpressions = (expressions: TriggerExpression[]): boolean => {
  return expressions.length > 0 && expressions.every(expr => validateExpression(expr))
}