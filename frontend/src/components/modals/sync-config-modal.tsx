'use client'
import { logger } from '@/lib/logger';

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import {
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    ModalTitle,
    ModalDescription
} from '@/components/ui/modal'
import {
    Plus,
    Loader2,
    User,
    Clock,
    Zap,
    Settings,
    Mail,
    CheckCircle,
    Search,
    ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface SyncConfig {
    id?: number
    account_id?: number
    enable_auto_sync: boolean
    sync_interval: number
    sync_folders: string[]
}

interface Account {
    id: number
    emailAddress: string
    name?: string
    authType?: string
    mailProviderId?: number
    mailProvider?: {
        id: number
        name: string
        type: string
        imapServer: string
        imapPort: number
    }
    isVerified?: boolean
}

interface PaginatedAccountsResponse {
    data: Account[]
    total: number
    page: number
    limit: number
    total_pages: number
}

interface Mailbox {
    id: number
    name: string
    delimiter: string
    flags: string[]
    is_deleted: boolean
}

interface SyncConfigModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    config?: SyncConfig & { account?: Account }
    mode: 'create' | 'edit' | 'global'
    accounts?: Account[]
}

export default function SyncConfigModal({
    isOpen,
    onClose,
    onSuccess,
    config,
    mode,
    accounts = []
}: SyncConfigModalProps) {
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState<SyncConfig>({
        enable_auto_sync: true,
        sync_interval: 300,
        sync_folders: ['INBOX']
    })
    const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
    const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
    const [customInterval, setCustomInterval] = useState<string>('')
    const [newFolder, setNewFolder] = useState('')

    // 账户搜索相关状态
    const [accountSearchQuery, setAccountSearchQuery] = useState('')
    const [showAccountDropdown, setShowAccountDropdown] = useState(false)
    const [filteredAccounts, setFilteredAccounts] = useState<Account[]>([])
    const [loadingAccounts, setLoadingAccounts] = useState(false)
    const [accountsPage, setAccountsPage] = useState(1)
    const [accountsLimit] = useState(10)
    const [accountsTotal, setAccountsTotal] = useState(0)
    const [accountsTotalPages, setAccountsTotalPages] = useState(1)
    const [hasMoreAccounts, setHasMoreAccounts] = useState(false)

    // 文件夹相关状态
    const [mailboxes, setMailboxes] = useState<Mailbox[]>([])
    const [loadingMailboxes, setLoadingMailboxes] = useState(false)

    // 引用用于点击外部关闭
    const accountDropdownRef = useRef<HTMLDivElement>(null)

    // 预定义的文件夹选项（仅作为最后的后备，优先使用从服务器获取的文件夹）
    const folderOptions = ['INBOX']  // 只保留 INBOX，其他文件夹应该从服务器动态获取

    // 预定义的同步间隔选项（标签形式）
    const intervalOptions = [
        { value: 5, label: '5s' },
        { value: 10, label: '10s' },
        { value: 30, label: '30s' },
        { value: 60, label: '1min' },
        { value: 300, label: '5min' },
        { value: 3600, label: '1h' },
        { value: 86400, label: '1d' }
    ]

    useEffect(() => {
        if (config) {
            setFormData({
                enable_auto_sync: config.enable_auto_sync,
                sync_interval: config.sync_interval,
                sync_folders: config.sync_folders || ['INBOX']
            })
            if (config.account_id) {
                setSelectedAccountId(config.account_id)
                // 如果有账户信息，设置选中的账户
                if (config.account) {
                    setSelectedAccount(config.account)
                }
            }
            // 如果是自定义间隔，设置自定义值
            const isCustomInterval = !intervalOptions.find(opt => typeof opt.value === 'number' && opt.value === config.sync_interval)
            if (isCustomInterval) {
                setCustomInterval(config.sync_interval.toString())
            }
        } else {
            setFormData({
                enable_auto_sync: true,
                sync_interval: 300,
                sync_folders: ['INBOX']
            })
            setSelectedAccountId(null)
            setSelectedAccount(null)
            setCustomInterval('')
        }
    }, [config])

    // 全局配置模式下加载全局配置
    useEffect(() => {
        const loadGlobalConfig = async () => {
            if (mode === 'global' && isOpen) {
                try {
                    const response = await apiClient.get('/sync/global-config')
                    const globalData = response.data || response
                    if (globalData) {
                        setFormData({
                            enable_auto_sync: globalData.default_enable_sync ?? true,
                            sync_interval: globalData.default_sync_interval ?? 300,
                            sync_folders: globalData.default_sync_folders || ['INBOX']
                        })
                        setCustomInterval(globalData.default_sync_interval?.toString() || '300')
                    }
                } catch (error) {
                    console.error('Failed to load global config:', error)
                }
            }
        }
        loadGlobalConfig()
    }, [mode, isOpen])

    // 加载账户数据的函数
    const loadAccounts = async (page: number = 1, search: string = '', reset: boolean = false) => {
        if (mode !== 'create') return;

        try {
            setLoadingAccounts(true);

            const params = new URLSearchParams({
                page: page.toString(),
                limit: accountsLimit.toString()
            });

            if (search.trim()) {
                params.append('search', search.trim());
            }

            const response = await apiClient.get(`/accounts/paginated?${params}`);
            const data: PaginatedAccountsResponse = response;
            logger.debug("API Response:", data);

            // 确保数据存在
            if (data && data.data) {
                if (reset || page === 1) {
                    setFilteredAccounts(data.data);
                    logger.debug("Set filtered accounts:", data.data);
                } else {
                    setFilteredAccounts(prev => [...prev, ...data.data]);
                }
            } else {
                console.error("No data in response");
                setFilteredAccounts([]);
            }

            setAccountsTotal(data.total || 0);
            setAccountsTotalPages(data.total_pages || 1);
            setHasMoreAccounts(page < (data.total_pages || 1));
            setAccountsPage(page);

        } catch (error) {
            console.error('Failed to load accounts:', error);
            setFilteredAccounts([]);
        } finally {
            setLoadingAccounts(false);
        }
    };

    // 加载账户文件夹
    const loadMailboxes = async (accountId: number) => {
        try {
            setLoadingMailboxes(true);
            const response = await apiClient.get(`/accounts/${accountId}/mailboxes`);
            setMailboxes(response);
        } catch (error) {
            console.error('Failed to load mailboxes:', error);
            setMailboxes([]);
        } finally {
            setLoadingMailboxes(false);
        }
    };

    // 初始加载账户数据 - 修改为模态框打开时就加载
    useEffect(() => {
        if (mode === 'create' && isOpen) {
            // 预加载账户数据，不需要等待下拉框打开
            loadAccounts(1, '', true);
        }
    }, [mode, isOpen]);

    // 当选择账户或编辑模式时加载文件夹
    useEffect(() => {
        const accountId = mode === 'edit' && config?.account_id ? config.account_id : selectedAccountId;
        if (accountId && isOpen) {
            loadMailboxes(accountId);
        }
    }, [selectedAccountId, config?.account_id, mode, isOpen]);

    // 搜索防抖处理
    useEffect(() => {
        if (mode !== 'create') return;

        const timeoutId = setTimeout(() => {
            if (showAccountDropdown) {
                loadAccounts(1, accountSearchQuery, true);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [accountSearchQuery, mode]);

    // 点击外部关闭下拉框
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
                setShowAccountDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleIntervalChange = (value: number) => {
        setFormData({ ...formData, sync_interval: value })
        setCustomInterval(value.toString()) // 在自定义输入框中回显数值
    }

    const handleCustomIntervalChange = (value: string) => {
        // 只允许输入正整数，不允许负数和小数
        if (value !== '' && (!/^\d+$/.test(value) || parseInt(value) < 1)) {
            return // 拒绝输入负数、小数或无效字符
        }

        setCustomInterval(value)
        // 允许空值，但如果有值则必须是正整数
        if (value === '') {
            // 允许为空，但不更新 formData 的 sync_interval
            return
        }
        const numValue = parseInt(value)
        if (!isNaN(numValue) && numValue >= 1) {
            setFormData({ ...formData, sync_interval: numValue })
        }
    }

    const toggleFolder = (folder: string) => {
        const folders = formData.sync_folders || []
        if (folders.includes(folder)) {
            setFormData({
                ...formData,
                sync_folders: folders.filter(f => f !== folder)
            })
        } else {
            setFormData({
                ...formData,
                sync_folders: [...folders, folder]
            })
        }
    }

    const addCustomFolder = () => {
        if (newFolder && !formData.sync_folders.includes(newFolder)) {
            setFormData({
                ...formData,
                sync_folders: [...formData.sync_folders, newFolder]
            })
            setNewFolder('')
        }
    }

    const removeFolder = (folder: string) => {
        setFormData({
            ...formData,
            sync_folders: formData.sync_folders.filter(f => f !== folder)
        })
    }

    const handleSubmit = async () => {
        try {
            setLoading(true)

            if (mode === 'create' && !selectedAccountId) {
                toast.error('请选择一个账户')
                return
            }

            // 检查是否有有效的同步间隔
            if (customInterval === '' && !formData.sync_interval) {
                toast.error('请输入同步间隔')
                return
            }

            // 验证自定义输入的值
            if (customInterval !== '') {
                const customValue = parseInt(customInterval)
                if (isNaN(customValue) || customValue < 1 || !Number.isInteger(customValue)) {
                    toast.error('同步间隔必须为正整数')
                    return
                }
            }

            // 最终验证 formData 中的值
            if (formData.sync_interval < 1 || !Number.isInteger(formData.sync_interval)) {
                toast.error('同步间隔必须为正整数')
                return
            }


            let endpoint = ''
            let method = ''
            let body: any = {
                enable_auto_sync: formData.enable_auto_sync,
                sync_interval: formData.sync_interval
            }

            if (mode === 'global') {
                endpoint = '/sync/global-config'
                method = 'PUT'
                body = {
                    default_enable_sync: formData.enable_auto_sync,
                    default_sync_interval: formData.sync_interval
                }
            } else if (mode === 'create') {
                endpoint = `/accounts/${selectedAccountId}/sync-config`
                method = 'POST'
            } else if (mode === 'edit' && config?.account_id) {
                endpoint = `/accounts/${config.account_id}/sync-config`
                method = 'PUT'
            }

            await apiClient.request({
                method,
                url: endpoint,
                data: body
            })

            toast.success(
                mode === 'global'
                    ? '全局同步配置已更新'
                    : mode === 'create'
                        ? '同步配置已创建'
                        : '同步配置已更新'
            )

            onSuccess()
            onClose()
        } catch (error) {
            console.error('Failed to save sync config:', error)
            toast.error('保存配置失败')
        } finally {
            setLoading(false)
        }
    }

    const getTitle = () => {
        switch (mode) {
            case 'global':
                return '编辑全局同步配置'
            case 'create':
                return '新增账户同步配置'
            case 'edit':
                return '编辑同步配置'
        }
    }

    const getDescription = () => {
        switch (mode) {
            case 'global':
                return '配置所有新账户的默认同步行为'
            case 'create':
                return '为指定账户创建同步配置'
            case 'edit':
                return `编辑 ${config?.account?.emailAddress || '账户'} 的同步配置`
        }
    }

    const getIcon = () => {
        switch (mode) {
            case 'global':
                return <Settings className="w-5 h-5 text-gray-400" />
            case 'create':
                return <Plus className="w-5 h-5 text-gray-400" />
            case 'edit':
                return <Mail className="w-5 h-5 text-gray-400" />
        }
    }

    const isCustomInterval = !intervalOptions.find(opt => opt.value === formData.sync_interval)

    // 检查是否是Gmail OAuth2账户
    const isGmailOAuth2 = (account: Account | null | undefined) => {
        if (!account) return false
        return account.authType === 'oauth2' &&
            account.mailProvider?.name?.toLowerCase().includes('gmail')
    }

    return (
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ModalContent size="xl" className="max-h-[90vh] flex flex-col">
                <ModalHeader>
                    <div className="flex items-center gap-3">
                        {getIcon()}
                        <div>
                            <ModalTitle>{getTitle()}</ModalTitle>
                            <ModalDescription>{getDescription()}</ModalDescription>
                        </div>
                    </div>
                </ModalHeader>

                <ModalBody className="flex-1 overflow-y-auto space-y-6">
                    {mode === 'create' && (
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                                <User className="w-4 h-4 text-gray-400" />
                                选择账户
                            </label>
                            <div className="relative" ref={accountDropdownRef}>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={selectedAccount ? selectedAccount.emailAddress : accountSearchQuery}
                                        onChange={(e) => {
                                            setAccountSearchQuery(e.target.value);
                                            setShowAccountDropdown(true);
                                            if (selectedAccountId) {
                                                setSelectedAccountId(null);
                                                setSelectedAccount(null);
                                            }
                                        }}
                                        onFocus={() => {
                                            logger.debug('Input focused, showing dropdown');
                                            setShowAccountDropdown(true);
                                            // 如果没有数据，重新加载
                                            if (filteredAccounts.length === 0 && !loadingAccounts) {
                                                loadAccounts(1, accountSearchQuery, true);
                                            }
                                        }}
                                        placeholder="搜索或选择账户..."
                                        className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-20 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                                        required
                                    />
                                    <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
                                        {loadingAccounts ? (
                                            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                                        ) : (
                                            <Search className="w-4 h-4 text-gray-400" />
                                        )}
                                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showAccountDropdown ? 'rotate-180' : ''}`} />
                                    </div>
                                </div>

                                {showAccountDropdown && (
                                    <div
                                        className="absolute w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                                        style={{ zIndex: 9999 }}
                                    >
                                        {(() => {
                                            logger.debug('Dropdown Debug:', {
                                                showAccountDropdown,
                                                filteredAccountsLength: filteredAccounts.length,
                                                loadingAccounts,
                                                mode
                                            });
                                            return null;
                                        })()}
                                        {loadingAccounts && filteredAccounts.length === 0 ? (
                                            <div className="px-3 py-2 text-gray-500 dark:text-gray-400 text-center flex items-center justify-center gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                加载中...
                                            </div>
                                        ) : filteredAccounts.length > 0 ? (
                                            <>
                                                {filteredAccounts.map((account) => (
                                                    <div
                                                        key={account.id}
                                                        onClick={() => {
                                                            setSelectedAccountId(account.id);
                                                            setSelectedAccount(account);
                                                            setAccountSearchQuery('');
                                                            setShowAccountDropdown(false);
                                                        }}
                                                        className={`px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 ${selectedAccountId === account.id ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'
                                                            }`}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-medium truncate">{account.emailAddress}</div>
                                                                {account.mailProvider && (
                                                                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                                                        {account.mailProvider.name}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 ml-2">
                                                                {account.isVerified && (
                                                                    <div className="w-2 h-2 bg-green-500 rounded-full" title="已验证" />
                                                                )}
                                                                {selectedAccountId === account.id && (
                                                                    <CheckCircle className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                                {hasMoreAccounts && (
                                                    <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-600">
                                                        <button
                                                            onClick={() => {
                                                                if (!loadingAccounts) {
                                                                    loadAccounts(accountsPage + 1, accountSearchQuery, false);
                                                                }
                                                            }}
                                                            disabled={loadingAccounts}
                                                            className="w-full text-center text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 disabled:opacity-50 flex items-center justify-center gap-2"
                                                        >
                                                            {loadingAccounts ? (
                                                                <>
                                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                                    加载中...
                                                                </>
                                                            ) : (
                                                                `加载更多 (${filteredAccounts.length}/${accountsTotal})`
                                                            )}
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <div className="px-3 py-2 text-gray-500 dark:text-gray-400 text-center">
                                                {accountSearchQuery ? '未找到匹配的账户' : '暂无账户数据'}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="flex items-center gap-2 text-base font-medium text-gray-700 dark:text-gray-300">
                                    <Zap className="w-4 h-4 text-gray-400" />
                                    启用自动同步
                                </label>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    开启后将按设定的间隔自动同步邮件
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    "text-sm font-medium",
                                    formData.enable_auto_sync ? "text-green-600 dark:text-green-400" : "text-gray-500 dark:text-gray-400"
                                )}>
                                    {formData.enable_auto_sync ? '开启' : '关闭'}
                                </span>
                                <Switch
                                    checked={formData.enable_auto_sync}
                                    onCheckedChange={(checked) =>
                                        setFormData({ ...formData, enable_auto_sync: checked })
                                    }
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                            <Clock className="w-4 h-4 text-gray-400" />
                            同步间隔
                        </label>

                        {/* 自定义输入和预设标签在同一行 */}
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <label className="text-sm text-gray-600 dark:text-gray-400">自定义:</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={customInterval || formData.sync_interval}
                                    onChange={(e) => handleCustomIntervalChange(e.target.value)}
                                    className="w-24 rounded-lg border border-gray-300 px-3 py-2 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
                                    placeholder="秒"
                                />
                                <span className="text-sm text-gray-500 dark:text-gray-400">秒</span>
                            </div>

                            {/* 预设标签选项 */}
                            <div className="flex flex-wrap gap-2">
                                {intervalOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => handleIntervalChange(option.value)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-full text-sm font-medium transition-all",
                                            formData.sync_interval === option.value
                                                ? "bg-primary-600 text-white hover:bg-primary-700"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                                        )}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            请输入正整数作为同步间隔（秒）
                        </p>
                    </div>

                    {/* Gmail OAuth2 特殊提示 */}
                    {(mode === 'edit' && isGmailOAuth2(config?.account)) ||
                        (mode === 'create' && isGmailOAuth2(selectedAccount)) ? (
                        <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 dark:bg-blue-900/20 dark:border-blue-800">
                            <div className="flex items-start gap-3">
                                <Mail className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                                <div className="space-y-2">
                                    <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                        Gmail API 优化同步
                                    </h4>
                                    <p className="text-sm text-blue-700 dark:text-blue-300">
                                        检测到您的Gmail账户使用OAuth2认证，系统将优先使用Gmail API进行轮询同步，以提供更高效和稳定的邮件同步体验。
                                    </p>
                                    <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/40 p-2 rounded">
                                        <div className="font-medium mb-1">Gmail API 配额消耗分析：</div>
                                        <ul className="space-y-0.5">
                                            <li>• 同步算法：History API(2配额) + Messages.Get(5配额/邮件)</li>
                                            <li>• 每分钟20封邮件时：220配额，利用率仅1.47%</li>
                                            <li>• 每秒1次同步极限：每分钟可处理2976封邮件</li>
                                            <li>• 每用户每分钟限制：15,000 个配额单位</li>
                                        </ul>
                                        <div className="mt-1 text-xs text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 p-1.5 rounded">
                                            <div className="font-medium">配额计算公式：</div>
                                            <div>每次同步 = 2 + 5×新邮件数量</div>
                                            <div>极限计算：(15000-60×2)÷5 = 2976封/分钟</div>
                                        </div>
                                        <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                                            <a
                                                href="https://developers.google.com/workspace/gmail/api/reference/quota"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 underline text-xs"
                                            >
                                                📖 查看官方文档
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                </ModalBody>

                <ModalFooter>
                    <Button variant="outline" onClick={onClose} disabled={loading}>
                        取消
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading}>
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                保存中...
                            </>
                        ) : (
                            <span>{mode === 'create' ? '创建' : '保存'}</span>
                        )}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}
