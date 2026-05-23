import { logger } from '@/lib/logger';
import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, MoreVertical, Edit2, Trash2, RefreshCw, Bell, Clock, Filter, Wifi, WifiOff, Grid, List, Table, ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { subscriptionService, Subscription, CacheStats } from '@/services/subscription.service';
import { emailAccountService } from '@/services/email-account.service';
import { EmailAccount } from '@/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';

// 视图类型
type ViewType = 'grid' | 'list' | 'table';

// 分页组件
function Pagination({
    currentPage,
    totalPages,
    onPageChange
}: {
    currentPage: number
    totalPages: number
    onPageChange: (page: number) => void
}) {
    const pages = []
    const maxVisiblePages = 5

    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2))
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1)

    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1)
    }

    for (let i = startPage; i <= endPage; i++) {
        pages.push(i)
    }

    return (
        <div className="flex items-center justify-center space-x-2">
            <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:text-gray-400 dark:hover:bg-gray-700"
            >
                <ChevronLeft className="h-5 w-5" />
            </button>

            {startPage > 1 && (
                <>
                    <button
                        onClick={() => onPageChange(1)}
                        className="rounded-lg px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        1
                    </button>
                    {startPage > 2 && <span className="text-gray-400">...</span>}
                </>
            )}

            {pages.map(page => (
                <button
                    key={page}
                    onClick={() => onPageChange(page)}
                    className={cn(
                        "rounded-lg px-3 py-1 text-sm transition-colors",
                        page === currentPage
                            ? "bg-primary-600 text-white"
                            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    )}
                >
                    {page}
                </button>
            ))}

            {endPage < totalPages && (
                <>
                    {endPage < totalPages - 1 && <span className="text-gray-400">...</span>}
                    <button
                        onClick={() => onPageChange(totalPages)}
                        className="rounded-lg px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        {totalPages}
                    </button>
                </>
            )}

            <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed dark:text-gray-400 dark:hover:bg-gray-700"
            >
                <ChevronRight className="h-5 w-5" />
            </button>
        </div>
    )
}

export function SubscriptionsTab() {
    const { confirm } = useConfirmDialog()
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);
    const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [wsConnected, setWsConnected] = useState(false);
    const [activeSubscriptions, setActiveSubscriptions] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [viewType, setViewType] = useState<ViewType>('grid');
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [pagination, setPagination] = useState({
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0
    });

    // Form state
    const [formData, setFormData] = useState({
        account_id: '',
        mailbox: 'INBOX',
        polling_interval: 60,
        include_body: true,
        from_filter: '',
        subject_filter: ''
    });

    // WebSocket event log
    const [eventLog, setEventLog] = useState<Array<{ time: string; type: string; data: any }>>([]);

    // 账户搜索相关状态
    const [accountSearchQuery, setAccountSearchQuery] = useState('');
    const [showAccountDropdown, setShowAccountDropdown] = useState(false);
    const [selectedAccount, setSelectedAccount] = useState<EmailAccount | null>(null);
    const accountSearchRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        loadData();
        connectWebSocket();

        return () => {
            subscriptionService.disconnectWebSocket();
        };
    }, [pagination.page, pagination.limit]);

    // 处理点击外部关闭下拉框
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (accountSearchRef.current && !accountSearchRef.current.contains(event.target as Node)) {
                setShowAccountDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            logger.debug('Starting to load data...'); // 调试日志
            const [subs, accs, stats] = await Promise.all([
                subscriptionService.getSubscriptions(),
                emailAccountService.getAccounts(),
                subscriptionService.getCacheStats()
            ]);

            logger.debug('Loaded accounts:', accs); // 调试日志
            logger.debug('Accounts type:', Array.isArray(accs) ? 'array' : typeof accs); // 调试日志
            logger.debug('Accounts length:', accs?.length); // 调试日志
            setSubscriptions(subs.subscriptions || []);
            setAccounts(accs || []); // 确保设置为数组
            setCacheStats(stats);

            // 计算分页信息
            const total = subs.total || 0;
            const totalPages = Math.ceil(total / pagination.limit);
            setPagination(prev => ({
                ...prev,
                total,
                totalPages
            }));
        } catch (error) {
            console.error('Failed to load data:', error);
            toast.error('加载数据失败');
        } finally {
            setLoading(false);
        }
    };

    const connectWebSocket = () => {
        subscriptionService.connectWebSocket(
            (connected) => {
                setWsConnected(connected);
                if (connected) {
                    toast.success('WebSocket 已连接');
                } else {
                    toast.error('WebSocket 连接断开');
                }
            },
            (event) => {
                setEventLog(prev => [...prev.slice(-9), {
                    time: new Date().toLocaleTimeString(),
                    type: event.type,
                    data: event.data
                }]);

                if (event.type === 'subscription_active') {
                    setActiveSubscriptions(prev => [...prev, event.data.subscription_id]);
                } else if (event.type === 'subscription_inactive') {
                    setActiveSubscriptions(prev => prev.filter(id => id !== event.data.subscription_id));
                }
            }
        );
    };

    const handleCreateSubscription = async () => {
        if (!formData.account_id) {
            toast.error('请选择邮箱账户');
            return;
        }

        setCreating(true);
        try {
            await subscriptionService.createSubscription({
                account_id: parseInt(formData.account_id),
                mailbox: formData.mailbox,
                polling_interval: formData.polling_interval,
                include_body: formData.include_body,
                from_filter: formData.from_filter,
                subject_filter: formData.subject_filter
            });

            toast.success('订阅创建成功');
            setShowCreateForm(false);
            setFormData({
                account_id: '',
                mailbox: 'INBOX',
                polling_interval: 60,
                include_body: true,
                from_filter: '',
                subject_filter: ''
            });
            await loadData();
        } catch (error) {
            console.error('Failed to create subscription:', error);
            toast.error('创建订阅失败');
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteSubscription = async (id: string) => {
        const confirmed = await confirm({
            title: '删除订阅',
            description: '确定要删除这个订阅吗？',
            confirmText: '删除',
            cancelText: '取消',
            variant: 'destructive'
        })
        if (!confirmed) return;

        try {
            await subscriptionService.deleteSubscription(id);
            toast.success('订阅已删除');
            await loadData();
        } catch (error) {
            console.error('Failed to delete subscription:', error);
            toast.error('删除订阅失败');
        }
    };

    const handlePageChange = (page: number) => {
        setPagination(prev => ({ ...prev, page }));
    };

    // 过滤和分页订阅
    const filteredSubscriptions = subscriptions.filter(sub =>
        sub.email_address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sub.mailbox.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // 应用分页
    const paginatedSubscriptions = filteredSubscriptions.slice(
        (pagination.page - 1) * pagination.limit,
        pagination.page * pagination.limit
    );

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'active':
                return 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400';
            case 'paused':
                return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400';
            default:
                return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="text-center">
                    <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent"></div>
                    <p className="text-gray-500 dark:text-gray-400">加载中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* 统计卡片 */}
            <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">活跃订阅</p>
                            <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                                {activeSubscriptions.length}
                            </p>
                        </div>
                        <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/20">
                            <Bell className="h-6 w-6 text-green-600 dark:text-green-400" />
                        </div>
                    </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">缓存统计</p>
                            <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                                {cacheStats?.total_size ? `${(cacheStats.total_size / 1024 / 1024).toFixed(2)} MB` : '0 MB'}
                            </p>
                        </div>
                        <div className="rounded-full bg-blue-100 p-3 dark:bg-blue-900/20">
                            <Clock className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                        </div>
                    </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">WebSocket状态</p>
                            <p className="mt-1 text-lg font-medium">
                                {wsConnected ? (
                                    <span className="flex items-center text-green-600 dark:text-green-400">
                                        <Wifi className="mr-1 h-4 w-4" />
                                        已连接
                                    </span>
                                ) : (
                                    <span className="flex items-center text-red-600 dark:text-red-400">
                                        <WifiOff className="mr-1 h-4 w-4" />
                                        未连接
                                    </span>
                                )}
                            </p>
                        </div>
                        <div className={cn(
                            "rounded-full p-3",
                            wsConnected ? "bg-green-100 dark:bg-green-900/20" : "bg-red-100 dark:bg-red-900/20"
                        )}>
                            {wsConnected ? (
                                <Wifi className="h-6 w-6 text-green-600 dark:text-green-400" />
                            ) : (
                                <WifiOff className="h-6 w-6 text-red-600 dark:text-red-400" />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 搜索和操作栏 */}
            <div className="flex items-center justify-between">
                <div className="relative w-96">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="搜索订阅..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                    />
                </div>
                <div className="flex items-center space-x-3">
                    {/* 视图切换按钮 */}
                    <div className="flex items-center rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
                        <button
                            onClick={() => setViewType('grid')}
                            className={cn(
                                "flex items-center space-x-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                viewType === 'grid'
                                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                            )}
                        >
                            <Grid className="h-4 w-4" />
                            <span>卡片</span>
                        </button>
                        <button
                            onClick={() => setViewType('list')}
                            className={cn(
                                "flex items-center space-x-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                viewType === 'list'
                                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                            )}
                        >
                            <List className="h-4 w-4" />
                            <span>列表</span>
                        </button>
                        <button
                            onClick={() => setViewType('table')}
                            className={cn(
                                "flex items-center space-x-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                                viewType === 'table'
                                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                            )}
                        >
                            <Table className="h-4 w-4" />
                            <span>表格</span>
                        </button>
                    </div>

                    {/* 创建订阅按钮 */}
                    <button
                        onClick={() => setShowCreateForm(true)}
                        className="flex items-center space-x-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                    >
                        <Plus className="h-4 w-4" />
                        <span>创建订阅</span>
                    </button>
                </div>
            </div>

            {/* 创建订阅表单 */}
            {showCreateForm && (
                <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
                    <h3 className="mb-4 text-lg font-medium text-gray-900 dark:text-white">创建新订阅</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div ref={accountSearchRef} className="relative">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                邮箱账户
                            </label>
                            <div className="relative mt-1">
                                <input
                                    type="text"
                                    value={selectedAccount ? selectedAccount.emailAddress : accountSearchQuery}
                                    onChange={(e) => {
                                        setAccountSearchQuery(e.target.value);
                                        setShowAccountDropdown(true);
                                        setSelectedAccount(null);
                                        setFormData({ ...formData, account_id: '' });
                                    }}
                                    onFocus={() => setShowAccountDropdown(true)}
                                    placeholder="搜索或选择邮箱账户"
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                />
                                {selectedAccount && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedAccount(null);
                                            setAccountSearchQuery('');
                                            setFormData({ ...formData, account_id: '' });
                                        }}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}

                                {showAccountDropdown && (
                                    <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                                        {accounts.length === 0 ? (
                                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                                                没有找到邮箱账户
                                            </div>
                                        ) : (
                                            <>
                                                {accounts
                                                    .filter(account =>
                                                        account.emailAddress.toLowerCase().includes(accountSearchQuery.toLowerCase())
                                                    )
                                                    .map((account) => (
                                                        <button
                                                            key={account.id}
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedAccount(account);
                                                                setFormData({ ...formData, account_id: account.id.toString() });
                                                                setAccountSearchQuery('');
                                                                setShowAccountDropdown(false);
                                                            }}
                                                            className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                                                        >
                                                            <div>
                                                                <div className="font-medium text-gray-900 dark:text-white">
                                                                    {account.emailAddress}
                                                                </div>
                                                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                    {account.mailProvider?.imapServer || '未知服务器'} • {account.isVerified ? '已验证' : '未验证'}
                                                                </div>
                                                            </div>
                                                        </button>
                                                    ))
                                                }
                                                {accounts.filter(account =>
                                                    account.emailAddress.toLowerCase().includes(accountSearchQuery.toLowerCase())
                                                ).length === 0 && (
                                                        <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                                                            没有匹配的邮箱账户
                                                        </div>
                                                    )}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                邮箱文件夹
                            </label>
                            <select
                                value={formData.mailbox}
                                onChange={(e) => setFormData({ ...formData, mailbox: e.target.value })}
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                            >
                                <option value="INBOX">收件箱</option>
                                <option value="Sent">已发送</option>
                                <option value="Drafts">草稿</option>
                                <option value="Trash">垃圾箱</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                轮询间隔（秒）
                            </label>
                            <input
                                type="number"
                                value={formData.polling_interval}
                                onChange={(e) => setFormData({ ...formData, polling_interval: parseInt(e.target.value) || 60 })}
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                min="30"
                            />
                        </div>

                        <div className="flex items-center">
                            <input
                                type="checkbox"
                                id="include_body"
                                checked={formData.include_body}
                                onChange={(e) => setFormData({ ...formData, include_body: e.target.checked })}
                                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                            />
                            <label htmlFor="include_body" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                                包含邮件正文
                            </label>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                发件人过滤
                            </label>
                            <input
                                type="text"
                                value={formData.from_filter}
                                onChange={(e) => setFormData({ ...formData, from_filter: e.target.value })}
                                placeholder="例如: @example.com"
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                主题过滤
                            </label>
                            <input
                                type="text"
                                value={formData.subject_filter}
                                onChange={(e) => setFormData({ ...formData, subject_filter: e.target.value })}
                                placeholder="例如: 重要通知"
                                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                            />
                        </div>
                    </div>

                    <div className="mt-4 flex justify-end space-x-3">
                        <button
                            onClick={() => setShowCreateForm(false)}
                            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleCreateSubscription}
                            disabled={creating || !formData.account_id}
                            className="flex items-center space-x-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
                        >
                            {creating && <RefreshCw className="h-4 w-4 animate-spin" />}
                            <span>{creating ? '创建中...' : '创建订阅'}</span>
                        </button>
                    </div>
                </div>
            )}

            {/* 订阅列表 */}
            {paginatedSubscriptions.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white p-12 text-center dark:border-gray-700 dark:bg-gray-800">
                    <Bell className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                    <p className="text-gray-500 dark:text-gray-400">
                        {searchQuery ? '没有找到匹配的订阅' : '还没有创建任何订阅'}
                    </p>
                    {!searchQuery && (
                        <button
                            onClick={() => setShowCreateForm(true)}
                            className="mt-4 text-primary-600 hover:text-primary-700"
                        >
                            创建第一个订阅
                        </button>
                    )}
                </div>
            ) : (
                <>
                    {viewType === 'grid' ? (
                        // 卡片视图
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {paginatedSubscriptions.map((subscription) => (
                                <div
                                    key={subscription.id}
                                    className="rounded-lg border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                                >
                                    <div className="mb-4 flex items-start justify-between">
                                        <div className="flex-1">
                                            <h3 className="font-medium text-gray-900 dark:text-white">
                                                {subscription.email_address}
                                            </h3>
                                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                                {subscription.mailbox}
                                            </p>
                                        </div>
                                        <div className="relative">
                                            <button className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700">
                                                <MoreVertical className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="mb-4 flex items-center justify-between">
                                        <span className={cn(
                                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                                            getStatusColor(subscription.status)
                                        )}>
                                            {subscription.status === 'active' ? '活跃' : '暂停'}
                                        </span>
                                        <div className="flex items-center space-x-1 text-xs text-gray-500 dark:text-gray-400">
                                            <Clock className="h-3 w-3" />
                                            <span>{subscription.polling_interval}秒</span>
                                        </div>
                                    </div>

                                    {(subscription.from_filter || subscription.subject_filter) && (
                                        <div className="mb-4 space-y-1">
                                            {subscription.from_filter && (
                                                <p className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                                                    <Filter className="mr-1 h-3 w-3" />
                                                    发件人: {subscription.from_filter}
                                                </p>
                                            )}
                                            {subscription.subject_filter && (
                                                <p className="flex items-center text-xs text-gray-500 dark:text-gray-400">
                                                    <Filter className="mr-1 h-3 w-3" />
                                                    主题: {subscription.subject_filter}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex space-x-2">
                                        <button
                                            className="flex flex-1 items-center justify-center space-x-1 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                        >
                                            {subscription.status === 'active' ? (
                                                <>
                                                    <Pause className="h-4 w-4" />
                                                    <span>暂停</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Play className="h-4 w-4" />
                                                    <span>启动</span>
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => handleDeleteSubscription(subscription.id)}
                                            className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : viewType === 'list' ? (
                        // 列表视图
                        <div className="space-y-3">
                            {paginatedSubscriptions.map((subscription) => (
                                <div
                                    key={subscription.id}
                                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                                >
                                    <div className="flex items-center space-x-4">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-white">
                                            <Bell className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-gray-900 dark:text-white">
                                                {subscription.email_address}
                                            </h3>
                                            <div className="mt-1 flex items-center space-x-3 text-sm text-gray-500 dark:text-gray-400">
                                                <span>{subscription.mailbox}</span>
                                                <span className={cn(
                                                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                                    getStatusColor(subscription.status)
                                                )}>
                                                    {subscription.status === 'active' ? '活跃' : '暂停'}
                                                </span>
                                                <div className="flex items-center space-x-1">
                                                    <Clock className="h-3 w-3" />
                                                    <span className="text-xs">{subscription.polling_interval}秒</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <button
                                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                                            title={subscription.status === 'active' ? '暂停' : '启动'}
                                        >
                                            {subscription.status === 'active' ? (
                                                <Pause className="h-4 w-4" />
                                            ) : (
                                                <Play className="h-4 w-4" />
                                            )}
                                        </button>
                                        <button
                                            onClick={() => handleDeleteSubscription(subscription.id)}
                                            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                                            title="删除"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        // 表格视图
                        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-900">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                            邮箱账户
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                            文件夹
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                            状态
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                            轮询间隔
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                            过滤器
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                            操作
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                                    {paginatedSubscriptions.map((subscription) => (
                                        <tr key={subscription.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                            <td className="whitespace-nowrap px-6 py-4">
                                                <div className="flex items-center">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-600 text-white">
                                                        <Bell className="h-5 w-5" />
                                                    </div>
                                                    <div className="ml-4">
                                                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                                                            {subscription.email_address}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                                                {subscription.mailbox}
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4">
                                                <span className={cn(
                                                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                                                    getStatusColor(subscription.status)
                                                )}>
                                                    {subscription.status === 'active' ? '活跃' : '暂停'}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                                                {subscription.polling_interval}秒
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                                                {subscription.from_filter || subscription.subject_filter ? (
                                                    <div className="space-y-1">
                                                        {subscription.from_filter && (
                                                            <p className="text-xs">发件人: {subscription.from_filter}</p>
                                                        )}
                                                        {subscription.subject_filter && (
                                                            <p className="text-xs">主题: {subscription.subject_filter}</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-400">无</span>
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-sm">
                                                <div className="flex items-center space-x-2">
                                                    <button
                                                        className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                                                        title={subscription.status === 'active' ? '暂停' : '启动'}
                                                    >
                                                        {subscription.status === 'active' ? (
                                                            <Pause className="h-4 w-4" />
                                                        ) : (
                                                            <Play className="h-4 w-4" />
                                                        )}
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteSubscription(subscription.id)}
                                                        className="rounded-lg p-1.5 text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                                        title="删除"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* 分页控件 */}
                    {pagination.totalPages > 0 && (
                        <div className="mt-8">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-4">
                                    <div className="text-sm text-gray-700 dark:text-gray-300">
                                        显示第 {(pagination.page - 1) * pagination.limit + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} 条，共 {pagination.total} 条
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <label htmlFor="pageSize" className="text-sm text-gray-600 dark:text-gray-400">
                                            每页显示：
                                        </label>
                                        <select
                                            id="pageSize"
                                            value={pagination.limit}
                                            onChange={(e) => {
                                                const newLimit = parseInt(e.target.value)
                                                setPagination(prev => ({
                                                    ...prev,
                                                    page: 1,
                                                    limit: newLimit
                                                }))
                                            }}
                                            className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                        >
                                            <option value="5">5</option>
                                            <option value="10">10</option>
                                            <option value="15">15</option>
                                            <option value="20">20</option>
                                            <option value="30">30</option>
                                            <option value="50">50</option>
                                        </select>
                                    </div>
                                </div>
                                {pagination.totalPages > 1 && (
                                    <Pagination
                                        currentPage={pagination.page}
                                        totalPages={pagination.totalPages}
                                        onPageChange={handlePageChange}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
