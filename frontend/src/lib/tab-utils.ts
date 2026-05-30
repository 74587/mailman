import { logger } from '@/lib/logger';
// Tab回调管理工具函数

// 全局回调注册表类型
type TabCallbacks = {
    [tabId: string]: {
        onReady?: (data: any) => void;
        onRefresh?: () => void;
        [key: string]: any;
    };
};

// 创建全局回调注册表
if (typeof window !== 'undefined') {
    (window as any).__tabCallbacks = (window as any).__tabCallbacks || {};
}

// 注册Tab回调的工具函数
export function registerTabCallback(tabId: string, callbackName: string, callback: any) {
    if (typeof window === 'undefined') return;

    (window as any).__tabCallbacks = (window as any).__tabCallbacks || {};
    (window as any).__tabCallbacks[tabId] = (window as any).__tabCallbacks[tabId] || {};
    (window as any).__tabCallbacks[tabId][callbackName] = callback;

    logger.debug(`[registerTabCallback] 已注册${tabId}的${callbackName}回调`);
}

// 移除Tab回调的工具函数
export function unregisterTabCallback(tabId: string, callbackName?: string) {
    if (typeof window === 'undefined') return;

    if (!callbackName) {
        // 移除整个Tab的所有回调
        delete (window as any).__tabCallbacks[tabId];
    } else {
        // 只移除特定回调
        if ((window as any).__tabCallbacks?.[tabId]) {
            delete (window as any).__tabCallbacks[tabId][callbackName];
        }
    }
}

// 刷新回调监听器管理
let refreshListeners: Map<string, () => void> = new Map();

// 注册Tab刷新回调 - 当Tab需要刷新时调用
export function registerRefreshCallback(tabId: string, callback: () => void) {
    if (typeof window === 'undefined') return;

    refreshListeners.set(tabId, callback);
    logger.debug(`[registerRefreshCallback] 已注册${tabId}的刷新回调`);
}

// 移除Tab刷新回调
export function unregisterRefreshCallback(tabId: string) {
    if (typeof window === 'undefined') return;

    refreshListeners.delete(tabId);
    logger.debug(`[unregisterRefreshCallback] 已移除${tabId}的刷新回调`);
}

export function hasRefreshCallback(tabId: string) {
    if (typeof window === 'undefined') return false;
    return refreshListeners.has(tabId);
}

// 初始化刷新事件监听器
if (typeof window !== 'undefined') {
    window.addEventListener('refreshTab', ((event: CustomEvent) => {
        const { tabId } = event.detail;
        logger.debug(`[tab-utils] 收到刷新事件:`, tabId);

        const callback = refreshListeners.get(tabId);
        if (callback) {
            logger.debug(`[tab-utils] 执行${tabId}的刷新回调`);
            callback();
        } else {
            logger.debug(`[tab-utils] ${tabId}未注册刷新回调`);
        }
    }) as EventListener);
}
