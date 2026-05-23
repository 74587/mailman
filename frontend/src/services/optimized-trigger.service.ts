import {
  EmailTrigger,
  PaginatedResponse,
  PaginationParams,
  EmailTriggerV2,
  TriggerExpression,
  TriggerActionV2,
  CreateTriggerV2Request,
  TriggerStatus,
  TriggerConditionConfig,
  TriggerActionConfig
} from '@/types';
import { cacheService } from './cache.service';
import { apiClient } from '@/lib/api-client';

/**
 * 优化的触发器服务
 * 使用缓存提高性能
 */
class OptimizedTriggerService {
  // apiClient 已包含 /api 前缀，使用 /triggers (路由到 EmailTriggerV2Controller)
  private apiBaseUrl = '/triggers';
  private cacheNamespace = 'triggers';
  private cacheTTL = 5 * 60 * 1000; // 5分钟缓存

  /**
   * 获取触发器列表
   * @param params 分页参数
   * @returns 分页触发器列表
   */
  async getTriggers(params?: PaginationParams): Promise<PaginatedResponse<EmailTrigger>> {
    const queryParams = new URLSearchParams();
    if (params) {
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.limit) queryParams.append('limit', params.limit.toString());
      if (params.search) queryParams.append('search', params.search);
      if (params.status) queryParams.append('status', params.status);
    }

    const url = `${this.apiBaseUrl}?${queryParams.toString()}`;
    const cacheKey = `list:${queryParams.toString()}`;

    // 尝试从缓存获取
    const cached = cacheService.get<PaginatedResponse<EmailTrigger>>(cacheKey, {
      namespace: this.cacheNamespace,
      ttl: this.cacheTTL
    });

    if (cached) {
      return cached;
    }

    // 缓存未命中，从API获取
    const v2Data = await apiClient.get<PaginatedResponse<EmailTriggerV2>>(url);

    const v1Data: PaginatedResponse<EmailTrigger> = {
      ...v2Data,
      data: v2Data.data.map(this.adaptToV1)
    };

    // 缓存结果
    cacheService.set(cacheKey, v1Data, {
      namespace: this.cacheNamespace,
      ttl: this.cacheTTL
    });

    return v1Data;
  }

  /**
   * 获取单个触发器
   * @param id 触发器ID
   * @returns 触发器详情
   */
  async getTrigger(id: number): Promise<EmailTrigger> {
    const cacheKey = `detail:${id}`;

    // 尝试从缓存获取
    const cached = cacheService.get<EmailTrigger>(cacheKey, {
      namespace: this.cacheNamespace,
      ttl: this.cacheTTL
    });

    if (cached) {
      return cached;
    }

    // 缓存未命中，从API获取
    const v2Data = await apiClient.get<EmailTriggerV2>(`${this.apiBaseUrl}/${id}`);
    const v1Data = this.adaptToV1(v2Data);

    // 缓存结果
    cacheService.set(cacheKey, v1Data, {
      namespace: this.cacheNamespace,
      ttl: this.cacheTTL
    });

    return v1Data;
  }

  /**
   * 创建触发器
   * @param trigger 触发器数据
   * @returns 创建的触发器
   */
  async createTrigger(trigger: Partial<EmailTrigger>): Promise<EmailTrigger> {
    // 将V1请求转换为V2请求
    const v2Trigger = this.adaptToV2(trigger);

    const v2Data = await apiClient.post<EmailTriggerV2>(this.apiBaseUrl, v2Trigger);
    const v1Data = this.adaptToV1(v2Data);

    // 清除列表缓存
    this.invalidateListCache();

    return v1Data;
  }

  /**
   * 更新触发器
   * @param id 触发器ID
   * @param trigger 触发器数据
   * @returns 更新后的触发器
   */
  async updateTrigger(id: number, trigger: Partial<EmailTrigger>): Promise<EmailTrigger> {
    // 将V1请求转换为V2请求（部分更新）
    const v2Trigger = this.adaptToV2(trigger);

    const v2Data = await apiClient.put<EmailTriggerV2>(`${this.apiBaseUrl}/${id}`, v2Trigger);
    const v1Data = this.adaptToV1(v2Data);

    // 更新缓存
    cacheService.set(`detail:${id}`, v1Data, {
      namespace: this.cacheNamespace,
      ttl: this.cacheTTL
    });

    // 清除列表缓存
    this.invalidateListCache();

    return v1Data;
  }

  /**
   * 删除触发器
   * @param id 触发器ID
   */
  async deleteTrigger(id: number): Promise<void> {
    await apiClient.delete(`${this.apiBaseUrl}/${id}`);

    // 删除缓存
    cacheService.delete(`detail:${id}`, {
      namespace: this.cacheNamespace
    });

    // 清除列表缓存
    this.invalidateListCache();
  }

  /**
   * 启用触发器
   * @param id 触发器ID
   * @returns 更新后的触发器
   */
  async enableTrigger(id: number): Promise<EmailTrigger> {
    const v2Data = await apiClient.post<EmailTriggerV2>(`${this.apiBaseUrl}/${id}/enable`);
    const v1Data = this.adaptToV1(v2Data);

    // 更新缓存
    cacheService.set(`detail:${id}`, v1Data, {
      namespace: this.cacheNamespace,
      ttl: this.cacheTTL
    });

    // 清除列表缓存
    this.invalidateListCache();

    return v1Data;
  }

  /**
   * 禁用触发器
   * @param id 触发器ID
   * @returns 更新后的触发器
   */
  async disableTrigger(id: number): Promise<EmailTrigger> {
    const v2Data = await apiClient.post<EmailTriggerV2>(`${this.apiBaseUrl}/${id}/disable`);
    const v1Data = this.adaptToV1(v2Data);

    // 更新缓存
    cacheService.set(`detail:${id}`, v1Data, {
      namespace: this.cacheNamespace,
      ttl: this.cacheTTL
    });

    // 清除列表缓存
    this.invalidateListCache();

    return v1Data;
  }

  /**
   * 测试触发器条件
   * @param expression 条件表达式
   * @param testData 测试数据
   * @returns 测试结果
   */
  async testTriggerCondition(expression: any, testData: any): Promise<any> {
    return await apiClient.post(`${this.apiBaseUrl}/test-condition`, {
      expression,
      testData
    });
  }

  /**
   * 测试触发器动作
   * @param action 动作配置
   * @param testData 测试数据
   * @returns 测试结果
   */
  async testTriggerAction(action: any, testData: any): Promise<any> {
    return await apiClient.post(`${this.apiBaseUrl}/test-action`, {
      action,
      testData
    });
  }

  /**
   * 获取触发器执行日志
   * @param params 查询参数
   * @returns 分页日志列表
   */
  async getTriggerLogs(params?: any): Promise<PaginatedResponse<any>> {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.append(key, String(value));
        }
      });
    }

    const url = `${this.apiBaseUrl}/logs?${queryParams.toString()}`;
    const cacheKey = `logs:${queryParams.toString()}`;

    // 尝试从缓存获取
    const cached = cacheService.get<PaginatedResponse<any>>(cacheKey, {
      namespace: this.cacheNamespace,
      ttl: 60 * 1000 // 日志缓存时间较短，1分钟
    });

    if (cached) {
      return cached;
    }

    // 缓存未命中，从API获取
    const data = await apiClient.get<PaginatedResponse<any>>(url);

    // 缓存结果
    cacheService.set(cacheKey, data, {
      namespace: this.cacheNamespace,
      ttl: 60 * 1000 // 日志缓存时间较短，1分钟
    });

    return data;
  }

  /**
   * 清除列表缓存
   */
  private invalidateListCache(): void {
    // 清除所有以list:开头的缓存
    cacheService.clearNamespace(this.cacheNamespace);
  }

  /**
   * 适配器：将 V2 触发器转换为 V1 格式
   */
  private adaptToV1(v2: EmailTriggerV2): EmailTrigger {
    const v1: EmailTrigger = {
      id: v2.id,
      name: v2.name,
      description: v2.description,
      status: v2.enabled ? 'enabled' : 'disabled',
      check_interval: 30, // Default or mock
      condition: { type: 'structural', script: '' }, // Mock legacy condition
      actions: [],
      enable_logging: true,
      total_executions: v2.totalExecutions,
      success_executions: v2.successExecutions,
      last_executed_at: v2.lastExecutedAt,
      last_error: v2.lastError,
      created_at: v2.createdAt,
      updated_at: v2.updatedAt,
      expressions: v2.expressions // Preserve full V2 expression tree
    };

    // Extract fields from expressions
    if (v2.expressions && v2.expressions.length > 0) {
      // Keep the expressions tree for the UI to use

      // Also attempt to populate legacy fields for backward compatibility display
      // Assume root is a GROUP or list of conditions. We look for specific fields.
      const processExpressions = (exprs: TriggerExpression[]) => {
        exprs.forEach(expr => {
          if (expr.type === 'group' && expr.conditions) {
            processExpressions(expr.conditions);
          } else if (expr.type === 'condition' && expr.field) {
            if (expr.field === 'subject' && expr.operator === 'contains') v1.subject = expr.value;
            if (expr.field === 'from' && expr.operator === 'contains') v1.from = expr.value;
            if (expr.field === 'to' && expr.operator === 'contains') v1.to = expr.value;
            if (expr.field === 'has_attachments' && expr.operator === 'equals') v1.has_attachment = expr.value;
            if (expr.field === 'unread' && expr.operator === 'equals') v1.unread = expr.value;
          }
        });
      };

      // If root is a single group, dig into it
      processExpressions(v2.expressions);
    }

    // Convert Actions
    if (v2.actions) {
      v1.actions = v2.actions.map(a => {
        let type: any = 'unknown'; // Use 'any' to bypass strict check if needed
        if (a.pluginId === 'email_modify_plugin') type = 'modify_content';
        if (a.pluginId === 'email_forward_plugin') type = 'smtp';

        return {
          type: type,
          name: a.pluginName,
          config: JSON.stringify(a.config),
          enabled: a.enabled,
          order: a.executionOrder
        } as TriggerActionConfig;
      });
    }

    return v1;
  }

  /**
   * 适配器：将 V1 触发器转换为 V2 格式
   */
  private adaptToV2(v1: Partial<EmailTrigger>): CreateTriggerV2Request {
    // If we have a full V2 expression tree, use it directly
    if (v1.expressions && v1.expressions.length > 0) {
      return {
        name: v1.name || 'Untitled Trigger',
        description: v1.description,
        enabled: v1.status === 'enabled',
        expressions: v1.expressions,
        actions: this.adaptActionsToV2(v1.actions || [])
      };
    }

    // Fallback: Construct V2 expressions from V1 fields
    const expressions: TriggerExpression[] = [];

    if (v1.subject) {
      expressions.push({ id: `temp_${Date.now()}_1`, type: 'condition', field: 'subject', operator: 'contains', value: v1.subject });
    }
    if (v1.from) {
      expressions.push({ id: `temp_${Date.now()}_2`, type: 'condition', field: 'from', operator: 'contains', value: v1.from });
    }
    if (v1.to) {
      expressions.push({ id: `temp_${Date.now()}_3`, type: 'condition', field: 'to', operator: 'contains', value: v1.to });
    }
    if (v1.has_attachment !== undefined) {
      expressions.push({ id: `temp_${Date.now()}_4`, type: 'condition', field: 'has_attachments', operator: 'equals', value: v1.has_attachment });
    }

    // Wrap in Root Group if needed
    let finalExpressions: TriggerExpression[] = [];
    if (expressions.length > 0) {
      finalExpressions = [{
        id: 'root',
        type: 'group',
        operator: 'and',
        conditions: expressions
      }];
    }

    const actions = this.adaptActionsToV2(v1.actions || []);

    return {
      name: v1.name || 'Untitled Trigger',
      description: v1.description,
      enabled: v1.status === 'enabled',
      expressions: finalExpressions,
      actions
    };
  }

  private adaptActionsToV2(v1Actions: TriggerActionConfig[]): TriggerActionV2[] {
    return v1Actions.map((a, index) => {
      let pluginId = 'unknown';
      if (a.type === 'modify_content') pluginId = 'email_modify_plugin';
      if (a.type === 'smtp') pluginId = 'email_forward_plugin';

      let config = {};
      try {
        config = JSON.parse(a.config);
      } catch (e) {
        config = { raw: a.config };
      }

      return {
        id: `action_${Date.now()}_${index}`,
        pluginId,
        pluginName: a.name,
        config,
        enabled: a.enabled,
        executionOrder: a.order
      };
    });
  }
}

// 导出单例
export const optimizedTriggerService = new OptimizedTriggerService();