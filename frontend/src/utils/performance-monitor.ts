import { logger } from '@/lib/logger';
/**
 * 性能监控工具
 * 用于测量和记录组件渲染性能
 */

interface PerformanceEntry {
  component: string;
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
}

class PerformanceMonitor {
  private entries: PerformanceEntry[] = [];
  private isEnabled: boolean = false;
  private maxEntries: number = 100;

  /**
   * 启用性能监控
   */
  enable(): void {
    this.isEnabled = true;
    logger.debug('性能监控已启用');
  }

  /**
   * 禁用性能监控
   */
  disable(): void {
    this.isEnabled = false;
    logger.debug('性能监控已禁用');
  }

  /**
   * 开始测量
   * @param component 组件名称
   * @param operation 操作名称
   * @returns 测量ID
   */
  start(component: string, operation: string): number {
    if (!this.isEnabled) return -1;
    
    const startTime = performance.now();
    const id = this.entries.length;
    
    this.entries.push({
      component,
      operation,
      startTime,
      endTime: 0,
      duration: 0
    });
    
    // 限制条目数量
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    
    return id;
  }

  /**
   * 结束测量
   * @param id 测量ID
   * @returns 测量持续时间（毫秒）
   */
  end(id: number): number {
    if (!this.isEnabled || id < 0 || id >= this.entries.length) return 0;
    
    const entry = this.entries[id];
    entry.endTime = performance.now();
    entry.duration = entry.endTime - entry.startTime;
    
    return entry.duration;
  }

  /**
   * 测量函数执行时间
   * @param component 组件名称
   * @param operation 操作名称
   * @param fn 要测量的函数
   * @returns 函数执行结果
   */
  measure<T>(component: string, operation: string, fn: () => T): T {
    const id = this.start(component, operation);
    const result = fn();
    this.end(id);
    return result;
  }

  /**
   * 测量异步函数执行时间
   * @param component 组件名称
   * @param operation 操作名称
   * @param fn 要测量的异步函数
   * @returns Promise<函数执行结果>
   */
  async measureAsync<T>(component: string, operation: string, fn: () => Promise<T>): Promise<T> {
    const id = this.start(component, operation);
    try {
      const result = await fn();
      this.end(id);
      return result;
    } catch (error) {
      this.end(id);
      throw error;
    }
  }

  /**
   * 获取性能报告
   * @returns 性能条目列表
   */
  getReport(): PerformanceEntry[] {
    return [...this.entries];
  }

  /**
   * 获取组件性能摘要
   * @returns 按组件分组的性能摘要
   */
  getSummary(): Record<string, { count: number, totalDuration: number, avgDuration: number }> {
    const summary: Record<string, { count: number, totalDuration: number, avgDuration: number }> = {};
    
    for (const entry of this.entries) {
      if (entry.endTime === 0) continue; // 跳过未完成的测量
      
      if (!summary[entry.component]) {
        summary[entry.component] = {
          count: 0,
          totalDuration: 0,
          avgDuration: 0
        };
      }
      
      summary[entry.component].count++;
      summary[entry.component].totalDuration += entry.duration;
      summary[entry.component].avgDuration = 
        summary[entry.component].totalDuration / summary[entry.component].count;
    }
    
    return summary;
  }

  /**
   * 打印性能报告到控制台
   */
  printReport(): void {
    if (this.entries.length === 0) {
      logger.debug('没有性能数据可供报告');
      return;
    }
    
    console.group('性能监控报告');
    
    // 打印摘要
    const summary = this.getSummary();
    console.table(summary);
    
    // 打印详细数据
    logger.debug('详细性能数据:');
    console.table(this.entries.map(entry => ({
      component: entry.component,
      operation: entry.operation,
      duration: entry.duration.toFixed(2) + 'ms',
      completed: entry.endTime > 0
    })));
    
    console.groupEnd();
  }

  /**
   * 清除性能数据
   */
  clear(): void {
    this.entries = [];
    logger.debug('性能数据已清除');
  }
}

// 导出单例
export const performanceMonitor = new PerformanceMonitor();