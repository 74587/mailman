import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Trash2, HelpCircle } from 'lucide-react'
import { TriggerExpression } from '@/types'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// 条件操作符
export type ConditionOperator = string;

// ... other imports

interface ConditionItemProps {
  condition: TriggerExpression
  onUpdate: (updatedCondition: TriggerExpression) => void
  onRemove: () => void
}

// 操作符帮助信息
const operatorHelp: Record<string, string> = {
  'equals': '检查字段值是否完全等于指定值',
  'not_equals': '检查字段值是否不等于指定值',
  'contains': '检查字段值是否包含指定值',
  'not_contains': '检查字段值是否不包含指定值',
  'starts_with': '检查字段值是否以指定值开头',
  'ends_with': '检查字段值是否以指定值结尾',
  'matches': '使用正则表达式匹配字段值',
  'greater_than': '检查字段值是否大于指定值',
  'less_than': '检查字段值是否小于指定值',
  'greater_equal': '检查字段值是否大于等于指定值',
  'less_equal': '检查字段值是否小于等于指定值',
  'in': '检查字段值是否在指定列表中（用逗号分隔）',
  'not_in': '检查字段值是否不在指定列表中（用逗号分隔）'
}

// 字段帮助信息
const fieldHelp: Record<string, string> = {
  'subject': '邮件的主题行',
  'from': '发件人邮箱地址',
  'to': '收件人邮箱地址',
  'cc': '抄送邮箱地址',
  'bcc': '密送邮箱地址',
  'body': '邮件的完整内容（HTML和纯文本）',
  'htmlBody': '邮件的HTML格式内容',
  'textBody': '邮件的纯文本格式内容',
  'hasAttachments': '邮件是否包含附件（true/false）',
  'date': '邮件的发送日期',
  'receivedAt': '邮件的接收日期',
  'messageId': '邮件的唯一标识符'
}

export function ConditionItem({ condition, onUpdate, onRemove }: ConditionItemProps) {
  const [showHelp, setShowHelp] = useState(false)

  // 更新条件字段
  const handleFieldChange = (value: string) => {
    onUpdate({
      ...condition,
      field: value
    })
  }

  // 更新条件操作符
  const handleOperatorChange = (value: string) => {
    onUpdate({
      ...condition,
      operator: value as ConditionOperator
    })
  }

  // 更新条件值
  const handleValueChange = (value: string) => {
    onUpdate({
      ...condition,
      value: value
    })
  }

  // 更新条件取反状态
  const handleNotChange = (checked: boolean) => {
    onUpdate({
      ...condition,
      not: checked
    })
  }

  // 获取字段类型
  const getFieldType = (field?: string): 'text' | 'boolean' | 'date' => {
    if (!field) return 'text'

    switch (field) {
      case 'hasAttachments':
        return 'boolean'
      case 'date':
      case 'receivedAt':
        return 'date'
      default:
        return 'text'
    }
  }

  // 渲染值输入框
  const renderValueInput = () => {
    const fieldType = getFieldType(condition.field)

    switch (fieldType) {
      case 'boolean':
        return (
          <Select
            value={String(condition.value)}
            onValueChange={handleValueChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择值" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">是 (true)</SelectItem>
              <SelectItem value="false">否 (false)</SelectItem>
            </SelectContent>
          </Select>
        )
      case 'date':
        return (
          <Input
            id={`value-${condition.id}`}
            type="datetime-local"
            value={condition.value || ''}
            onChange={(e) => handleValueChange(e.target.value)}
          />
        )
      default:
        return (
          <Input
            id={`value-${condition.id}`}
            value={condition.value || ''}
            onChange={(e) => handleValueChange(e.target.value)}
            placeholder={condition.operator === 'in' || condition.operator === 'not_in' ? '值1,值2,值3' : '输入值'}
          />
        )
    }
  }

  return (
    <div className="grid grid-cols-12 gap-2 mb-2 items-end">
      <div className="col-span-3">
        <div className="flex items-center gap-1">
          <Label htmlFor={`field-${condition.id}`}>字段</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                  <HelpCircle className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{fieldHelp[condition.field || ''] || '选择要检查的邮件字段'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Select
          value={condition.field}
          onValueChange={handleFieldChange}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择字段" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="subject">邮件主题</SelectItem>
            <SelectItem value="from">发件人</SelectItem>
            <SelectItem value="to">收件人</SelectItem>
            <SelectItem value="cc">抄送</SelectItem>
            <SelectItem value="bcc">密送</SelectItem>
            <SelectItem value="body">邮件内容</SelectItem>
            <SelectItem value="htmlBody">HTML内容</SelectItem>
            <SelectItem value="textBody">纯文本内容</SelectItem>
            <SelectItem value="hasAttachments">有附件</SelectItem>
            <SelectItem value="date">日期</SelectItem>
            <SelectItem value="receivedAt">接收时间</SelectItem>
            <SelectItem value="messageId">消息ID</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="col-span-3">
        <div className="flex items-center gap-1">
          <Label htmlFor={`operator-${condition.id}`}>操作符</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                  <HelpCircle className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{operatorHelp[condition.operator || ''] || '选择比较操作符'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Select
          value={condition.operator}
          onValueChange={handleOperatorChange}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="选择操作符" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="equals">等于</SelectItem>
            <SelectItem value="not_equals">不等于</SelectItem>
            <SelectItem value="contains">包含</SelectItem>
            <SelectItem value="not_contains">不包含</SelectItem>
            <SelectItem value="starts_with">开头是</SelectItem>
            <SelectItem value="ends_with">结尾是</SelectItem>
            <SelectItem value="matches">匹配正则</SelectItem>
            <SelectItem value="greater_than">大于</SelectItem>
            <SelectItem value="less_than">小于</SelectItem>
            <SelectItem value="greater_equal">大于等于</SelectItem>
            <SelectItem value="less_equal">小于等于</SelectItem>
            <SelectItem value="in">在列表中</SelectItem>
            <SelectItem value="not_in">不在列表中</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="col-span-5">
        <Label htmlFor={`value-${condition.id}`}>值</Label>
        {renderValueInput()}
      </div>

      <div className="col-span-1 flex items-center justify-center">
        <Label htmlFor={`not-${condition.id}`} className="mr-2">取反</Label>
        <input
          id={`not-${condition.id}`}
          type="checkbox"
          checked={condition.not === true}
          onChange={(e) => handleNotChange(e.target.checked)}
          className="h-4 w-4"
        />
      </div>

      <div className="col-span-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}