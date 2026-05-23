import { apiClient } from '@/lib/api-client'
import { TriggerExpression } from '@/types'
import { expressionsToApiFormat } from '@/components/triggers/condition-utils'

// 条件测试服务
export const conditionTestService = {
  // 测试条件表达式
  async testCondition(expressions: TriggerExpression[], testData: any): Promise<any> {
    try {
      // 使用 V2 API
      const response = await apiClient.post<any>('/v2/triggers/test-condition', {
        expressions: expressionsToApiFormat(expressions),
        testData
      })

      return response
    } catch (error) {
      console.error('测试条件失败:', error)
      throw error
    }
  },

  // 模拟测试条件表达式（用于开发和测试）
  async mockTestCondition(expressions: TriggerExpression[], testData: any): Promise<any> {
    // 模拟API延迟
    await new Promise(resolve => setTimeout(resolve, 500))

    // 简单的条件评估逻辑
    const evaluateExpression = (expr: TriggerExpression): { result: boolean, details: any } => {
      if (expr.type === 'condition') {
        let result = false
        const field = expr.field || ''
        const operator = expr.operator || 'equals'
        const value = expr.value
        const fieldValue = testData[field]

        switch (operator) {
          case 'equals':
            result = String(fieldValue) === String(value)
            break
          case 'not_equals':
            result = String(fieldValue) !== String(value)
            break
          case 'contains':
            result = String(fieldValue).includes(String(value))
            break
          case 'not_contains':
            result = !String(fieldValue).includes(String(value))
            break
          case 'starts_with':
            result = String(fieldValue).startsWith(String(value))
            break
          case 'ends_with':
            result = String(fieldValue).endsWith(String(value))
            break
          default:
            result = false
        }

        // 处理取反
        if (expr.not) {
          result = !result
        }

        return {
          result,
          details: {
            id: expr.id,
            type: expr.type,
            field,
            operator,
            value,
            fieldValue,
            result,
            not: expr.not
          }
        }
      } else if (expr.type === 'group') {
        const childResults = expr.conditions?.map(child => evaluateExpression(child)) || []
        const operator = expr.operator || 'and'

        let result
        if (operator === 'and') {
          result = childResults.every(r => r.result)
        } else if (operator === 'or') {
          result = childResults.some(r => r.result)
        } else if (operator === 'not') {
          result = childResults.length > 0 ? !childResults[0].result : true
        } else {
          result = false
        }

        // 处理取反
        if (expr.not) {
          result = !result
        }

        return {
          result,
          details: {
            id: expr.id,
            type: expr.type,
            operator,
            result,
            not: expr.not,
            details: childResults.map(r => r.details)
          }
        }
      }

      return { result: false, details: { error: '未知表达式类型' } }
    }

    // 评估所有表达式
    const results = expressions.map(expr => evaluateExpression(expr))
    const finalResult = results.every(r => r.result)

    return {
      result: finalResult,
      details: results.length === 1 ? results[0].details : {
        type: 'group',
        operator: 'and',
        result: finalResult,
        details: results.map(r => r.details)
      }
    }
  }
}