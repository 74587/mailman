'use client'
import { logger } from '@/lib/logger';

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
    Mail,
    RefreshCw,
    Settings,
    Play,
    Square,
    Copy,
    Check,
    Plus,
    Loader2,
    AlertCircle,
    Clock,
    Inbox,
    Trash2,
    ChevronRight,
    Eye,
    EyeOff,
    Code,
    FileText,
    X,
    ArrowLeft,
    Shuffle,
    AtSign,
    Globe,
    Search,
    Calendar
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { emailAccountService } from '@/services/email-account.service'
import { EmailAccount, Email, ExtractorTemplate } from '@/types'
import { formatDate } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { registerTabCallback, unregisterTabCallback } from '@/lib/tab-utils'
import { extractorTemplateService } from '@/services/extractor-template.service'
import { syncConfigService } from '@/services/sync-config.service'
import { subscriptionService } from '@/services/subscription.service'
import CreateSyncConfigModal from '@/components/modals/create-sync-config-modal'

interface ExtractConfig {
    field: string
    type: string
    match?: string
    extract: string
}

interface WaitEmailConfig {
    timeout: number
    interval: number
    startTime?: string
    extract: ExtractConfig[]
}

interface MonitoredEmail {
    id: string
    email: string
    config: WaitEmailConfig
    isListening: boolean
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error'
    checksPerformed: number
    elapsedTime: number
    receivedEmails: Email[]
    extractedData: Record<string, any>[]
    showConfig?: boolean
    startTime?: Date  // 添加开始监听的时间
    subscriptionId?: string  // 后端订阅ID，用于取消订阅
}

export default function MailPickupTab() {
    const [accounts, setAccounts] = useState<EmailAccount[]>([])
    const [accountDomains, setAccountDomains] = useState<string[]>([])
    const [monitoredEmails, setMonitoredEmails] = useState<MonitoredEmail[]>([])
    const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null)
    // 添加一个状态变量，用于跟踪是否应该跳过邮箱选择
    const [skipEmailSelection, setSkipEmailSelection] = useState(false)
    const [selectedEmail, setSelectedEmail] = useState<Email | null>(null)
    const [customPrefix, setCustomPrefix] = useState<string>('')
    const [selectedDomain, setSelectedDomain] = useState<string>('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [viewMode, setViewMode] = useState<'html' | 'text' | 'raw'>('html')
    const [copiedId, setCopiedId] = useState<string | null>(null)
    const [useAlias, setUseAlias] = useState(false)
    const [useDomain, setUseDomain] = useState(true)
    const [accountSearchTerm, setAccountSearchTerm] = useState('')
    const [showAccountDropdown, setShowAccountDropdown] = useState(false)
    const [extractorTemplates, setExtractorTemplates] = useState<ExtractorTemplate[]>([])
    const [extractorSearchTerm, setExtractorSearchTerm] = useState('')
    const [showExtractorDropdown, setShowExtractorDropdown] = useState(false)

    // 同步配置相关状态
    const [showSyncConfigModal, setShowSyncConfigModal] = useState(false)
    const [syncConfigAccountId, setSyncConfigAccountId] = useState<number>(0)
    const [syncConfigAccountEmail, setSyncConfigAccountEmail] = useState<string>('')

    // 监听状态管理 - key是邮箱，value是监听配置和状态
    const listeningStateRef = useRef<{
        [email: string]: {
            email: string;
            startTime: Date;
            config: {
                interval: number;
                timeout: number;
                extract: ExtractConfig[];
            };
            isListening: boolean;
            checksPerformed: number;
            accountId?: number;
        }
    }>({});

    // 轮询模式相关变量
    const pollIntervalRef = useRef<{ [key: string]: NodeJS.Timeout | null }>({})
    const lastCheckTimeRef = useRef<{ [key: string]: Date }>({})
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const accountDropdownRef = useRef<HTMLDivElement>(null)
    const extractorDropdownRef = useRef<HTMLDivElement>(null)

    // 格式化时长显示
    const formatDuration = (seconds: number): string => {
        if (seconds < 60) {
            return `${seconds}秒`
        }
        const minutes = Math.floor(seconds / 60)
        const remainingSeconds = seconds % 60
        if (minutes < 60) {
            return remainingSeconds > 0 ? `${minutes}分${remainingSeconds}秒` : `${minutes}分钟`
        }
        const hours = Math.floor(minutes / 60)
        const remainingMinutes = minutes % 60
        return remainingMinutes > 0 ? `${hours}小时${remainingMinutes}分钟` : `${hours}小时`
    }

    // 定时更新监听时长
    useEffect(() => {
        const interval = setInterval(() => {
            setMonitoredEmails(prev => prev.map(email => {
                if (email.isListening && email.startTime) {
                    const elapsed = Math.floor((new Date().getTime() - email.startTime.getTime()) / 1000)
                    return { ...email, elapsedTime: elapsed }
                }
                return email
            }))
        }, 1000) // 每秒更新一次

        return () => clearInterval(interval)
    }, [])

    // 初始化时检查localStorage和恢复状态
    useEffect(() => {
        // 从localStorage获取之前保存的邮箱状态
        const savedEmailState = getEmailStateFromStorage();
        const savedMonitoredEmails = getMonitoredEmailsFromStorage();

        if (savedEmailState) {
            logger.debug('[MailPickupTab] 从localStorage恢复选中的邮箱:', savedEmailState);

            // 如果有保存的监控邮箱列表，先恢复它
            if (savedMonitoredEmails && savedMonitoredEmails.length > 0) {
                logger.debug('[MailPickupTab] 从localStorage恢复监控邮箱列表');
                setMonitoredEmails(savedMonitoredEmails);
            } else {
                // 如果没有保存的列表，但有选中的邮箱，确保它被添加
                const emailExists = monitoredEmails.some(m => m.email === savedEmailState.email);
                if (!emailExists) {
                    logger.debug('[MailPickupTab] 添加已保存的邮箱到监控列表:', savedEmailState.email);
                    addMonitoredEmail(savedEmailState.email);
                }
            }

            // 恢复选中状态
            logger.debug('[MailPickupTab] 恢复选中邮箱ID:', savedEmailState.id);
            setSelectedEmailId(savedEmailState.id);

            // 设置跳过标记，避免被其他操作覆盖
            setSkipEmailSelection(true);
        }

        // 获取账户和域名
        fetchAccountsAndDomains();
    }, []);

    // 监听选中的邮箱ID变化，保存到localStorage
    useEffect(() => {
        if (selectedEmailId && !skipEmailSelection) {
            const selectedEmail = monitoredEmails.find(m => m.id === selectedEmailId);
            if (selectedEmail) {
                logger.debug('[MailPickupTab] 选中邮箱变化，保存到localStorage:', selectedEmail.email);
                saveEmailStateToStorage(selectedEmailId, selectedEmail.email, monitoredEmails);
            }
        }
    }, [selectedEmailId, monitoredEmails, skipEmailSelection]);

    // 点击外部关闭下拉框
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
                setShowAccountDropdown(false)
            }
            if (extractorDropdownRef.current && !extractorDropdownRef.current.contains(event.target as Node)) {
                setShowExtractorDropdown(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [])
    // 清除localStorage中的邮箱状态
    const clearEmailStateFromStorage = () => {
        try {
            localStorage.removeItem('selectedPickupEmail');
            localStorage.removeItem('monitoredEmails');
        } catch (error) {
            console.error('[MailPickupTab] 无法清除localStorage中的邮箱状态:', error);
        }
    };

    // 保存邮箱状态到localStorage的工具函数
    const saveEmailStateToStorage = (emailId: string, emailAddress: string, allEmails: MonitoredEmail[]) => {
        try {
            localStorage.setItem('selectedPickupEmail', JSON.stringify({
                id: emailId,
                email: emailAddress,
                timestamp: new Date().getTime()
            }));

            // 可选地保存整个监控邮箱列表
            localStorage.setItem('monitoredEmails', JSON.stringify({
                emails: allEmails,
                timestamp: new Date().getTime()
            }));

            logger.debug('[MailPickupTab] 保存邮箱状态到localStorage:', emailId, emailAddress);
        } catch (error) {
            console.error('[MailPickupTab] 无法保存邮箱状态到localStorage:', error);
        }
    };

    // 从localStorage获取邮箱状态的工具函数
    const getEmailStateFromStorage = () => {
        try {
            const data = localStorage.getItem('selectedPickupEmail');
            if (!data) return null;

            const emailState = JSON.parse(data);
            // 检查数据是否过期（10分钟）
            if (new Date().getTime() - emailState.timestamp > 10 * 60 * 1000) {
                localStorage.removeItem('selectedPickupEmail');
                return null;
            }

            return emailState;
        } catch (error) {
            console.error('[MailPickupTab] 无法从localStorage获取邮箱状态:', error);
            return null;
        }
    };

    // 从localStorage获取监控邮箱列表
    const getMonitoredEmailsFromStorage = () => {
        try {
            const data = localStorage.getItem('monitoredEmails');
            if (!data) return null;

            const emailsState = JSON.parse(data);
            // 检查数据是否过期（10分钟）
            if (new Date().getTime() - emailsState.timestamp > 10 * 60 * 1000) {
                localStorage.removeItem('monitoredEmails');
                return null;
            }

            return emailsState.emails;
        } catch (error) {
            console.error('[MailPickupTab] 无法从localStorage获取监控邮箱列表:', error);
            return null;
        }
    };

    // 用于全局追踪是否已经处理过数据的标记 - 使用window对象存储，确保在组件重新挂载时保留
    const processedDataRef = useRef<Set<string>>(
        typeof window !== 'undefined'
            ? ((window as any).__mailPickupProcessedData = (window as any).__mailPickupProcessedData || new Set<string>())
            : new Set<string>()
    );

    // 处理从账户管理页面切换过来的数据
    const handleTabSwitchData = useCallback((data: any) => {
        logger.debug('[MailPickupTab] 回调函数收到数据:', data);

        if (data) {
            // 先检查数据是否已有processed标记
            if (data.__processed === true) {
                logger.debug('[MailPickupTab] 数据已被主页面标记为已处理，跳过');
                return;
            }

            const { selectedAccount: accountEmail, customDomain: domain, __timestamp } = data;

            // 使用时间戳创建更可靠的ID
            const dataId = `mail-pickup:${accountEmail || ''}:${domain || ''}:${__timestamp || new Date().getTime()}`;

            // 在全局对象中检查是否处理过
            if (processedDataRef.current.has(dataId)) {
                logger.debug('[MailPickupTab] 数据已全局处理过，跳过:', dataId);
                return;
            }

            // 标记为已全局处理
            processedDataRef.current.add(dataId);
            logger.debug('[MailPickupTab] 标记数据为已处理:', dataId);

            // 如果传入了账户邮箱，添加到监控列表
            if (accountEmail) {
                logger.debug('[MailPickupTab] 收到账户邮箱:', accountEmail);

                // 使用增强版addMonitoredEmail直接获取ID
                // 如果邮箱已存在，会返回现有ID；如果不存在，会添加并返回新ID
                const emailId = addMonitoredEmail(accountEmail);
                logger.debug('[MailPickupTab] 添加/获取邮箱ID:', emailId);

                // 直接设置为选中状态，不需要setTimeout
                logger.debug('[MailPickupTab] 设置邮箱为选中状态:', emailId);
                setSelectedEmailId(emailId);

                // 同时保存到localStorage，确保组件重新挂载时能恢复状态
                saveEmailStateToStorage(emailId, accountEmail, monitoredEmails);

                // 设置跳过标记，确保loadAccounts不会覆盖选择
                setSkipEmailSelection(true);
            }

            // 如果传入了域名，设置为选中的域名
            if (domain && accountDomains.includes(domain)) {
                logger.debug('[MailPickupTab] 设置域名:', domain);
                setSelectedDomain(domain);
                setUseDomain(true);
            }

            // 5秒后清除这个ID，以便将来可以再次处理相同的数据
            setTimeout(() => {
                processedDataRef.current.delete(dataId);
                logger.debug('[MailPickupTab] 已清除处理记录:', dataId);
            }, 5000);
        }
    }, [monitoredEmails, accountDomains]);

    // 只在组件首次挂载时注册回调，并在组件卸载时清理
    useEffect(() => {
        // 避免重复注册
        if ((window as any).__mailPickupCallbackRegistered) {
            logger.debug('[MailPickupTab] 回调已注册，跳过重复注册');
            return;
        }

        logger.debug('[MailPickupTab] 首次注册onReady回调函数');

        // 标记已注册
        (window as any).__mailPickupCallbackRegistered = true;

        // 注册回调函数
        registerTabCallback('mail-pickup', 'onReady', handleTabSwitchData);

        // 创建一个自定义事件，通知主页面回调已注册
        const event = new CustomEvent('tabCallbackRegistered', {
            detail: { tabId: 'mail-pickup', callbackName: 'onReady' }
        });
        window.dispatchEvent(event);

        return () => {
            // 卸载组件时不立即注销回调，避免短时间内重复注册和注销
            logger.debug('[MailPickupTab] 组件卸载，但保留回调注册状态');

            // 设置延迟清理，给足够时间让组件稳定下来
            setTimeout(() => {
                logger.debug('[MailPickupTab] 延迟清理回调状态');
                (window as any).__mailPickupCallbackRegistered = false;
            }, 2000);
        };
    }, []); // 空依赖数组，确保只在组件首次挂载时执行

    // 处理点击外部关闭下拉框
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
                setShowAccountDropdown(false)
            }
            if (extractorDropdownRef.current && !extractorDropdownRef.current.contains(event.target as Node)) {
                setShowExtractorDropdown(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [])

    const fetchAccountsAndDomains = async () => {
        try {
            setLoading(true)
            const [accountsData, domainsData, templatesData] = await Promise.all([
                emailAccountService.getAccounts(),
                apiClient.get<{ domains: string[] }>('/email-domains'),
                extractorTemplateService.getTemplates(1, 100) // 获取前100个模板
            ])
            setAccounts(accountsData)

            // 从账户中提取域名
            const domains = domainsData.domains || []
            setAccountDomains(domains)

            // 设置默认域名
            if (domains.length > 0 && !selectedDomain) {
                setSelectedDomain(domains[0])
            }

            // 设置提取器模板
            setExtractorTemplates((templatesData?.data) || [])
        } catch (err) {
            console.error('Error fetching data:', err)
            setError('获取账户信息失败')
            // 确保在错误情况下也设置为空数组
            setExtractorTemplates([])
        } finally {
            setLoading(false)
        }
    }

    // 过滤账户列表
    const filteredAccounts = accounts.filter(account =>
        account.emailAddress.toLowerCase().includes(accountSearchTerm.toLowerCase())
    )

    // 过滤提取器模板列表
    const filteredExtractorTemplates = (extractorTemplates || []).filter(template =>
        template.name.toLowerCase().includes(extractorSearchTerm.toLowerCase()) ||
        template.description?.toLowerCase().includes(extractorSearchTerm.toLowerCase())
    )

    // 获取随机邮箱
    const getRandomEmail = async () => {
        try {
            const params = new URLSearchParams()
            if (useAlias) params.append('alias', 'true')
            if (useDomain) params.append('domain', 'true')

            const data = await apiClient.get<{ status: string; email: string; message?: string }>(`/random-email?${params}`)
            if (data.status === 'success') {
                addMonitoredEmail(data.email)
            } else {
                setError(data.message || '获取随机邮箱失败')
            }
        } catch (err) {
            console.error('Error getting random email:', err)
            setError('获取随机邮箱失败')
        }
    }

    // 生成随机前缀
    const generateRandomPrefix = () => {
        const prefixes = ['user', 'mail', 'temp', 'random', 'test', 'inbox', 'receive', 'pickup']
        const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)]
        const randomNum = Math.floor(Math.random() * 999999)
        setCustomPrefix(`${randomPrefix}${randomNum}`)
    }

    // 生成自定义邮箱
    const generateCustomEmail = () => {
        if (customPrefix && selectedDomain) {
            const email = `${customPrefix}@${selectedDomain}`
            addMonitoredEmail(email)
            setCustomPrefix('')
        }
    }

    // 添加监控邮箱（增强版，防止重复添加，并保存到localStorage）
    const addMonitoredEmail = (email: string) => {
        logger.debug(`[MailPickupTab] 尝试添加邮箱: ${email}`);

        // 首先检查这个邮箱是否已经在监控列表中
        const existingEmail = monitoredEmails.find(m => m.email === email);
        if (existingEmail) {
            logger.debug(`[MailPickupTab] 邮箱 ${email} 已存在，ID: ${existingEmail.id}，不重复添加`);

            // 更新到localStorage，确保状态持久化
            saveEmailStateToStorage(existingEmail.id, email, monitoredEmails);

            return existingEmail.id; // 返回已存在邮箱的ID
        }

        // 创建新邮箱
        const id = Date.now().toString();
        logger.debug(`[MailPickupTab] 添加新邮箱: ${email}，ID: ${id}`);
        const newEmail: MonitoredEmail = {
            id,
            email,
            config: {
                timeout: 300,
                interval: 5,
                startTime: new Date().toISOString(),
                extract: []
            },
            isListening: false,
            connectionStatus: 'disconnected',
            checksPerformed: 0,
            elapsedTime: 0,
            receivedEmails: [],
            extractedData: [],
            showConfig: false
        }

        // 更新状态并保存到localStorage
        const updatedEmails = [...monitoredEmails, newEmail];
        setMonitoredEmails(updatedEmails);
        saveEmailStateToStorage(id, email, updatedEmails);

        return id; // 返回新邮箱的ID
    }

    // 从现有账户添加
    const addFromAccount = (accountEmail: string) => {
        logger.debug(`[MailPickupTab] 从账户添加邮箱: ${accountEmail}`);

        // 获取邮箱ID（如果已存在则返回现有ID，否则添加并返回新ID）
        // addMonitoredEmail会自动保存到localStorage
        const emailId = addMonitoredEmail(accountEmail);

        // 设置为选中状态
        logger.debug(`[MailPickupTab] 设置邮箱为选中状态: ${emailId}`);
        setSelectedEmailId(emailId);

        // 设置跳过标记，确保不会被自动选择覆盖
        setSkipEmailSelection(true);

        // 清理界面状态
        setAccountSearchTerm('');
        setShowAccountDropdown(false);
    }

    // 删除监控邮箱
    const removeMonitoredEmail = (id: string) => {
        const email = monitoredEmails.find(m => m.id === id)
        if (email?.isListening) {
            stopListening(id)
        }

        // 移除邮箱
        const updatedEmails = monitoredEmails.filter(m => m.id !== id);
        setMonitoredEmails(updatedEmails)

        // 如果删除的是当前选中的邮箱，清除选中状态
        if (selectedEmailId === id) {
            setSelectedEmailId(null)
            setSelectedEmail(null)

            // 从localStorage中清除已删除的邮箱
            if (updatedEmails.length > 0) {
                // 如果还有其他邮箱，选择第一个
                const firstEmail = updatedEmails[0];
                saveEmailStateToStorage(firstEmail.id, firstEmail.email, updatedEmails);
            } else {
                // 如果没有邮箱了，清除localStorage
                clearEmailStateFromStorage();
            }
        } else {
            // 即使删除的不是当前选中的邮箱，也更新localStorage中的邮箱列表
            const selected = monitoredEmails.find(m => m.id === selectedEmailId);
            if (selected) {
                saveEmailStateToStorage(selected.id, selected.email, updatedEmails);
            }
        }
    }

    // 复制邮箱
    const copyEmail = (email: string, id: string) => {
        navigator.clipboard.writeText(email)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    // 更新配置
    const updateConfig = (id: string, config: Partial<WaitEmailConfig>) => {
        setMonitoredEmails(prev => prev.map(m =>
            m.id === id ? { ...m, config: { ...m.config, ...config } } : m
        ))
    }

    // 切换配置显示
    const toggleConfig = (id: string) => {
        setMonitoredEmails(prev => prev.map(m =>
            m.id === id ? { ...m, showConfig: !m.showConfig } : m
        ))
    }

    // 格式化日期时间为本地时间字符串
    const formatDateTimeLocal = (dateString: string) => {
        const date = new Date(dateString)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const hours = String(date.getHours()).padStart(2, '0')
        const minutes = String(date.getMinutes()).padStart(2, '0')
        return `${year}-${month}-${day}T${hours}:${minutes}`
    }

    // 检查邮箱是否已在系统中注册
    const checkEmailRegistered = async (emailAddress: string): Promise<boolean> => {
        try {
            logger.debug(`[轮询] checkEmailRegistered 被调用，邮箱: ${emailAddress}, 账户列表:`, accounts);

            // 处理别名邮箱的情况
            // Gmail 别名格式: username+alias@gmail.com -> username@gmail.com
            let baseEmail = emailAddress.toLowerCase();
            const plusIndex = baseEmail.indexOf('+');
            const atIndex = baseEmail.indexOf('@');

            if (plusIndex > 0 && atIndex > plusIndex) {
                // 移除 + 和 @ 之间的部分，得到基础邮箱地址
                baseEmail = baseEmail.substring(0, plusIndex) + baseEmail.substring(atIndex);
                logger.debug(`[轮询] 检测到别名邮箱，基础邮箱地址: ${baseEmail}`);
            }

            // 尝试从账户列表中查找邮箱（同时检查原始邮箱和基础邮箱）
            const registeredAccount = accounts.find(account => {
                const accountEmail = account.emailAddress.toLowerCase();
                return accountEmail === emailAddress.toLowerCase() || accountEmail === baseEmail;
            });

            if (registeredAccount) {
                logger.debug(`[轮询] 邮箱 ${emailAddress} 已在系统中注册（匹配账户: ${registeredAccount.emailAddress}）`)
                return true
            }

            // 如果没找到，尝试通过API查询
            logger.debug(`[轮询] 邮箱 ${emailAddress} 未在本地账户列表中找到`)

            // 这里可以添加API调用来查询邮箱是否存在
            // 例如：const response = await apiClient.get(`/check-email-exists?email=${encodeURIComponent(emailAddress)}`)

            // 由于目前没有此API，我们假设不在账户列表中的邮箱未注册
            return false
        } catch (error) {
            console.error(`[轮询] 检查邮箱注册状态时出错:`, error)
            return false
        }
    }

    // 开始监听邮件 - 改进版，修复状态闭包问题
    const startListening = useCallback(async (id: string) => {
        logger.debug('[监听] startListening 被调用，ID:', id);

        // 使用函数式更新来获取最新状态，避免闭包问题
        let emailToListen: MonitoredEmail | undefined = undefined;

        setMonitoredEmails(prev => {
            emailToListen = prev.find(m => m.id === id);
            return prev; // 不修改状态，只是获取最新值
        });

        if (!emailToListen) {
            console.error('[监听] 无法找到邮箱ID:', id)
            setError('无法找到要监听的邮箱')
            return
        }

        // 类型断言，确保TypeScript知道emailToListen不为空
        const email = emailToListen as MonitoredEmail;

        logger.debug('[监听] 找到邮箱:', email.email);

        // 邮箱地址格式验证
        if (!email.email || !email.email.includes('@')) {
            console.error('[监听] 邮箱地址无效:', email.email)
            setError(`邮箱地址 ${email.email} 格式无效`)
            return
        }

        logger.debug('[监听] 邮箱格式验证通过');

        try {
            // 清空缓存（如果需要的话）
            logger.debug('[监听] 清空邮件缓存...');
            // TODO: 实现清空缓存的逻辑

            // 对于随机邮箱或域名邮箱，我们不需要检查是否注册
            // 只需要确保有一个账户ID用于API调用
            let accountId: number | null = null;

            // 尝试查找匹配的账户（支持别名邮箱）
            let baseEmail = email.email.toLowerCase();
            const plusIndex = baseEmail.indexOf('+');
            const atIndex = baseEmail.indexOf('@');

            if (plusIndex > 0 && atIndex > plusIndex) {
                // 移除 + 和 @ 之间的部分，得到基础邮箱地址
                baseEmail = baseEmail.substring(0, plusIndex) + baseEmail.substring(atIndex);
            }

            const account = accounts.find(acc => {
                const accountEmail = acc.emailAddress.toLowerCase();
                return accountEmail === email.email.toLowerCase() || accountEmail === baseEmail;
            });

            if (account) {
                logger.debug(`[监听] 找到匹配的账户: ${account.emailAddress}, ID: ${account.id}`);
                accountId = account.id;

                // 检查是否有同步配置
                logger.debug('[监听] 检查同步配置...')
                try {
                    const effectiveConfig = await syncConfigService.getEffectiveSyncConfig(account.id)
                    logger.debug('[监听] 获取到有效配置:', effectiveConfig)

                    // 如果没有用户配置或临时配置，显示创建同步配置的模态框
                    if (!effectiveConfig.config || (!effectiveConfig.is_temporary && !effectiveConfig.config.id)) {
                        logger.debug('[监听] 没有找到同步配置，需要创建')
                        setShowSyncConfigModal(true)
                        setSyncConfigAccountId(account.id)
                        setSyncConfigAccountEmail(email.email)
                        return
                    }
                } catch (error) {
                    logger.debug('[监听] 获取同步配置失败，显示创建模态框')
                    setShowSyncConfigModal(true)
                    setSyncConfigAccountId(account.id)
                    setSyncConfigAccountEmail(email.email)
                    return
                }
            } else {
                // 对于随机邮箱或域名邮箱，使用默认账户ID或第一个账户
                logger.debug(`[监听] 未找到匹配账户，使用默认账户监听邮箱: ${email.email}`);
                if (accounts.length > 0) {
                    accountId = accounts[0].id;
                    logger.debug(`[监听] 使用第一个账户ID: ${accountId}`);
                } else {
                    // 如果没有任何账户，我们仍然可以监听，但使用accountId=0
                    accountId = 0;
                    logger.debug('[监听] 没有找到任何账户，使用accountId=0进行监听');
                }
            }

            // 开始监听
            logger.debug('[监听] 开始监听邮箱:', email.email, '配置:', email.config)

            // 每次点击监听都重新设置开始时间，确保超时时间正确刷新
            const listeningStartTime = new Date();
            logger.debug(`[监听] 重置监听开始时间: ${listeningStartTime.toISOString()}`);

            // 更新UI状态
            setMonitoredEmails(prev => prev.map(m =>
                m.id === id ? {
                    ...m,
                    isListening: true,
                    connectionStatus: 'connecting',
                    checksPerformed: 0,
                    elapsedTime: 0,
                    startTime: listeningStartTime  // 设置开始时间
                } : m
            ))

            // 初始化监听状态
            listeningStateRef.current[email.email] = {
                email: email.email,
                startTime: listeningStartTime,
                config: {
                    interval: email.config.interval || 5,
                    timeout: email.config.timeout || 0, // 默认一直监听
                    extract: email.config.extract || []
                },
                isListening: true,
                checksPerformed: 0,
                accountId: accountId // 保存账户ID
            };

            // 初始化最后检查时间为监听开始时间
            lastCheckTimeRef.current[id] = listeningStartTime;
            logger.debug(`[监听] 初始化监听开始时间: ${listeningStartTime.toISOString()}`);

            // 更新状态为已连接
            setMonitoredEmails(prev => prev.map(m =>
                m.id === id ? {
                    ...m,
                    connectionStatus: 'connected',
                } : m
            ))

            // 设置轮询间隔
            const intervalSeconds = email.config.interval || 5;
            logger.debug(`[监听] 设置轮询间隔: ${intervalSeconds} 秒`);

            // 使用setTimeout确保状态更新完成后再执行首次检查
            setTimeout(() => {
                logger.debug('[监听] 执行首次立即检查');
                if (accountId !== null) {
                    checkEmailsViaSearchAPI(email.email, accountId);
                }
            }, 100);
        } catch (error) {
            console.error('[监听] 启动监听时出错:', error);
            setError('启动监听失败: ' + (error as any).message)
        }
    }, [accounts, syncConfigService]) // 添加依赖项

    // 通过搜索API检查邮件
    const checkEmailsViaSearchAPI = async (email: string, accountId: number) => {
        try {
            const now = new Date();

            // 从监听状态中获取配置
            const listeningState = listeningStateRef.current[email];
            if (!listeningState || !listeningState.isListening) {
                logger.debug(`[搜索] 邮箱 ${email} 不在监听状态或已停止监听`);
                return;
            }

            logger.debug(`[搜索] 检查邮件: ${email}, 监听开始时间: ${listeningState.startTime.toISOString()}, 当前时间: ${now.toISOString()}`);

            // 更新检查次数
            listeningState.checksPerformed++;

            // 同步更新UI状态
            setMonitoredEmails(prev => prev.map(m =>
                m.email === email ? {
                    ...m,
                    checksPerformed: listeningState.checksPerformed,
                    elapsedTime: Math.round((now.getTime() - listeningState.startTime.getTime()) / 1000)
                } : m
            ));

            // 构建搜索参数
            const searchParams = new URLSearchParams({
                account_id: accountId.toString(),
                start_date: listeningState.startTime.toISOString(),
                limit: '10',
                sort_by: 'date_desc',
                // 添加 to_query 参数，确保只获取发送给特定别名的邮件
                to_query: email
            });

            logger.debug(`[搜索] 发送请求到 /api/emails/search:`, searchParams.toString());
            logger.debug(`[搜索] 使用 to_query 过滤器: ${email}`);

            // 调用搜索API
            const response = await apiClient.get(`/emails/search?${searchParams.toString()}`);

            logger.debug(`[搜索] 收到响应:`, response);

            // 处理搜索结果
            if (response && response.emails && response.emails.length > 0) {
                logger.debug(`[搜索] 找到 ${response.emails.length} 封新邮件`);

                // 使用函数式更新获取最新状态并进行去重
                let newEmailsToAdd: Email[] = [];
                let extractedDataToAdd: Record<string, any>[] = [];
                let shouldSelectFirstEmail = false;

                setMonitoredEmails(prev => {
                    const currentMonitoredEmail = prev.find(m => m.email === email);
                    if (!currentMonitoredEmail) {
                        console.warn(`[搜索] 未找到监控邮箱: ${email}`);
                        return prev;
                    }

                    // 获取当前已接收的邮件ID集合（使用Set提高查找效率）
                    const receivedEmailIds = new Set(currentMonitoredEmail.receivedEmails.map(e => e.ID));

                    // 过滤出真正的新邮件（基于ID去重）
                    newEmailsToAdd = response.emails.filter((e: Email) => !receivedEmailIds.has(e.ID));

                    if (newEmailsToAdd.length > 0) {
                        logger.debug(`[搜索] 发现 ${newEmailsToAdd.length} 封新邮件`);

                        // 检查是否需要自动选择第一封邮件
                        shouldSelectFirstEmail = selectedEmailId === currentMonitoredEmail.id && currentMonitoredEmail.receivedEmails.length === 0;

                        // 使用Map确保邮件ID的唯一性（额外保险）
                        const allEmails = [...newEmailsToAdd, ...currentMonitoredEmail.receivedEmails];
                        const uniqueEmailsMap = new Map();
                        allEmails.forEach(email => {
                            uniqueEmailsMap.set(email.ID, email);
                        });
                        const uniqueEmails = Array.from(uniqueEmailsMap.values());

                        // 按时间倒序排序（最新的邮件在前）
                        uniqueEmails.sort((a, b) => {
                            const dateA = new Date(a.date || a.Date || 0);
                            const dateB = new Date(b.date || b.Date || 0);
                            return dateB.getTime() - dateA.getTime();
                        });

                        logger.debug(`[搜索] 邮件已按时间倒序排序，共 ${uniqueEmails.length} 封邮件`);

                        return prev.map(m =>
                            m.email === email ? {
                                ...m,
                                receivedEmails: uniqueEmails
                            } : m
                        );
                    }

                    return prev;
                });

                // 处理提取配置（在状态更新后）
                if (newEmailsToAdd.length > 0) {
                    if (listeningState.config.extract && listeningState.config.extract.length > 0) {
                        for (const emailItem of newEmailsToAdd) {
                            const extracted = await extractDataFromEmail(emailItem, listeningState.config.extract);
                            if (extracted) {
                                extractedDataToAdd.push(extracted);
                            }
                        }
                    }

                    // 更新提取的数据
                    if (extractedDataToAdd.length > 0) {
                        setMonitoredEmails(prev => prev.map(m =>
                            m.email === email ? {
                                ...m,
                                extractedData: [...extractedDataToAdd, ...m.extractedData]
                            } : m
                        ));
                    }

                    // 如果这是第一封邮件，自动选择它
                    if (shouldSelectFirstEmail) {
                        setSelectedEmail(newEmailsToAdd[0]);
                    }
                }
            }

            logger.debug(`[搜索] 第 ${listeningState.checksPerformed} 次检查完成`);

            // 检查是否还需要继续监听（如果没有设置超时或未超时）
            const elapsedSeconds = Math.round((now.getTime() - listeningState.startTime.getTime()) / 1000);
            if (listeningState.isListening &&
                (listeningState.config.timeout === 0 || elapsedSeconds < listeningState.config.timeout)) {
                setTimeout(() => {
                    checkEmailsViaSearchAPI(email, accountId);
                }, listeningState.config.interval * 1000);
            } else if (listeningState.config.timeout > 0 && elapsedSeconds >= listeningState.config.timeout) {
                // 超时停止
                logger.debug(`[搜索] 监听超时，停止监听`);
                stopListening(email);
            }
        } catch (error: any) {
            console.error(`[搜索] 检查邮件时出错:`, error);

            // 更详细的错误信息
            let errorMessage = '搜索邮件时出错: ';
            if (error.response) {
                // 服务器返回了错误响应
                console.error('[搜索] 服务器错误响应:', error.response);
                errorMessage += `服务器返回 ${error.response.status}: ${error.response.data || error.response.statusText}`;
            } else if (error.request) {
                // 请求已发送但没有收到响应
                console.error('[搜索] 请求未收到响应:', error.request);
                errorMessage += '请求未收到响应，请检查网络连接';
            } else {
                // 其他错误
                errorMessage += error.message || String(error);
            }

            setError(errorMessage);

            // 如果是严重错误，停止监听
            if (error.response?.status === 404 || error.response?.status === 401) {
                console.error(`[搜索] 严重错误，停止监听`);
                stopListening(email);
            }
        }
    };

    // 从邮件中提取数据
    const extractDataFromEmail = async (email: Email, extractConfigs: ExtractConfig[]): Promise<Record<string, any> | null> => {
        if (!extractConfigs || extractConfigs.length === 0) {
            return null;
        }

        const extracted: Record<string, any> = {};

        for (const config of extractConfigs) {
            let content = '';

            // 根据字段类型获取内容
            switch (config.field) {
                case 'subject':
                    content = email.Subject || '';
                    break;
                case 'body':
                    content = email.Body || '';
                    break;
                case 'from':
                    content = email.From ? email.From.join(', ') : '';
                    break;
                default:
                    continue;
            }

            // 执行提取
            if (config.type === 'regex' && config.match) {
                try {
                    const regex = new RegExp(config.match);
                    const match = content.match(regex);
                    if (match) {
                        extracted[config.extract] = match[1] || match[0];
                    }
                } catch (e) {
                    console.error('正则表达式错误:', e);
                }
            }
        }

        return Object.keys(extracted).length > 0 ? extracted : null;
    };

    // 停止监听 - 统一函数，支持通过ID或邮箱地址停止
    const stopListening = async (idOrEmail: string) => {
        // 支持通过ID或邮箱地址查找
        const monitoredEmail = monitoredEmails.find(m => m.id === idOrEmail || m.email === idOrEmail);
        if (!monitoredEmail) return;

        logger.debug('[监听] 停止监听邮箱:', monitoredEmail.email);

        // 完全清理监听状态，避免状态污染
        if (listeningStateRef.current[monitoredEmail.email]) {
            delete listeningStateRef.current[monitoredEmail.email];
        }

        // 停止轮询（如果正在进行）
        if (pollIntervalRef.current[monitoredEmail.id]) {
            logger.debug(`[监听] 停止轮询模式 (${monitoredEmail.id})`);
            clearInterval(pollIntervalRef.current[monitoredEmail.id]!);
            pollIntervalRef.current[monitoredEmail.id] = null;
        }

        // 如果有后端订阅ID，调用API删除订阅
        if (monitoredEmail.subscriptionId) {
            try {
                logger.debug(`[监听] 删除后端订阅: ${monitoredEmail.subscriptionId}`);
                await subscriptionService.deleteSubscription(monitoredEmail.subscriptionId);
                logger.debug(`[监听] 成功删除后端订阅: ${monitoredEmail.subscriptionId}`);
            } catch (error) {
                console.error(`[监听] 删除后端订阅失败:`, error);
                // 即使删除失败也继续清理前端状态
            }
        }

        setMonitoredEmails(prev => prev.map(m =>
            m.id === monitoredEmail.id ? {
                ...m,
                isListening: false,
                connectionStatus: 'disconnected',
                ws: undefined,
                startTime: undefined,  // 清除开始时间
                subscriptionId: undefined  // 清除订阅ID
            } : m
        ))
    }

    // 添加提取规则
    const addExtractRule = (id: string) => {
        const email = monitoredEmails.find(m => m.id === id)
        if (!email) return

        updateConfig(id, {
            extract: [
                ...email.config.extract,
                {
                    field: 'body',
                    type: 'regex',
                    extract: ''
                }
            ]
        })
    }

    // 更新提取规则
    const updateExtractRule = (id: string, index: number, field: keyof ExtractConfig, value: string) => {
        const email = monitoredEmails.find(m => m.id === id)
        if (!email) return

        const newExtract = [...email.config.extract]
        newExtract[index] = { ...newExtract[index], [field]: value }
        updateConfig(id, { extract: newExtract })
    }

    // 删除提取规则
    const removeExtractRule = (id: string, index: number) => {
        const email = monitoredEmails.find(m => m.id === id)
        if (!email) return

        updateConfig(id, {
            extract: email.config.extract.filter((_, i) => i !== index)
        })
    }

    // 应用提取器模板
    const applyExtractorTemplate = (emailId: string, template: ExtractorTemplate) => {
        updateConfig(emailId, {
            extract: template.extractors.map(extractor => ({
                field: extractor.field,
                type: extractor.type,
                match: extractor.match,
                extract: extractor.extract || extractor.config || ''
            }))
        })
        setExtractorSearchTerm('')
        setShowExtractorDropdown(false)
    }

    // 获取选中的邮箱
    const selectedMonitoredEmail = monitoredEmails.find(m => m.id === selectedEmailId)

    // 渲染HTML内容
    useEffect(() => {
        if (selectedEmail?.HTMLBody && viewMode === 'html' && iframeRef.current) {
            const doc = iframeRef.current.contentDocument
            if (doc) {
                doc.open()
                doc.write(selectedEmail.HTMLBody)
                doc.close()
            }
        }
    }, [selectedEmail, viewMode])

    return (
        <div className="flex h-full">
            {/* 左侧面板 */}
            <div className="w-1/2 border-r border-gray-200 p-6 dark:border-gray-700 overflow-y-auto">
                <div className="mb-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                        邮箱管理
                    </h2>

                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* 添加邮箱控制 */}
                            <div className="bg-gradient-to-r from-primary-50 to-primary-100 dark:from-primary-900/20 dark:to-primary-800/20 rounded-lg p-4 border border-primary-200 dark:border-primary-800">
                                {/* 选择现有账户 - 改为可编辑的下拉搜索框 */}
                                <div className="mb-3">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        从现有账户添加
                                    </label>
                                    <div className="relative" ref={accountDropdownRef}>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={accountSearchTerm}
                                                onChange={(e) => {
                                                    setAccountSearchTerm(e.target.value)
                                                    setShowAccountDropdown(true)
                                                }}
                                                onFocus={() => setShowAccountDropdown(true)}
                                                placeholder="搜索或选择账户..."
                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
                                            />
                                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                        </div>

                                        {/* 下拉列表 */}
                                        {showAccountDropdown && filteredAccounts.length > 0 && (
                                            <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800 max-h-60 overflow-y-auto">
                                                {filteredAccounts.map((account) => (
                                                    <button
                                                        key={account.id}
                                                        onClick={() => addFromAccount(account.emailAddress)}
                                                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                    >
                                                        {account.emailAddress}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* 自定义域名邮箱 */}
                                {accountDomains.length > 0 && (
                                    <div className="mb-3">
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            自定义域名邮箱
                                        </label>
                                        <div className="flex space-x-2">
                                            <input
                                                type="text"
                                                value={customPrefix}
                                                onChange={(e) => setCustomPrefix(e.target.value)}
                                                placeholder="邮箱前缀"
                                                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
                                            />
                                            <button
                                                onClick={generateRandomPrefix}
                                                className="p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 rounded-lg transition-colors"
                                                title="生成随机前缀"
                                            >
                                                <Shuffle className="h-4 w-4" />
                                            </button>
                                            <span className="flex items-center text-gray-500">@</span>
                                            <select
                                                value={selectedDomain}
                                                onChange={(e) => setSelectedDomain(e.target.value)}
                                                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
                                            >
                                                {accountDomains.map((domain) => (
                                                    <option key={domain} value={domain}>
                                                        {domain}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={generateCustomEmail}
                                                disabled={!customPrefix || !selectedDomain}
                                                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                                            >
                                                生成
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* 随机邮箱 */}
                                <div className="space-y-3">
                                    <div className="flex items-center space-x-4">
                                        <label className="flex items-center space-x-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={useAlias}
                                                onChange={(e) => setUseAlias(e.target.checked)}
                                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                            />
                                            <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
                                                <AtSign className="h-4 w-4 mr-1" />
                                                使用别名邮箱
                                            </span>
                                        </label>
                                        <label className="flex items-center space-x-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={useDomain}
                                                onChange={(e) => setUseDomain(e.target.checked)}
                                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                            />
                                            <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center">
                                                <Globe className="h-4 w-4 mr-1" />
                                                使用域名邮箱
                                            </span>
                                        </label>
                                    </div>
                                    <button
                                        onClick={getRandomEmail}
                                        className="w-full rounded-lg bg-gradient-to-r from-primary-600 to-primary-700 px-4 py-2 text-sm font-medium text-white hover:from-primary-700 hover:to-primary-800 transition-all transform hover:scale-[1.02] active:scale-[0.98]"
                                    >
                                        <RefreshCw className="mr-2 inline h-4 w-4" />
                                        获取随机邮箱
                                    </button>
                                </div>
                            </div>

                            {/* 监控的邮箱列表 */}
                            <div className="space-y-2">
                                {monitoredEmails.length === 0 ? (
                                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                        <Inbox className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                        <p>还没有添加任何邮箱</p>
                                        <p className="text-sm mt-1">点击上方按钮添加邮箱开始监听</p>
                                    </div>
                                ) : (
                                    monitoredEmails.map((email) => (
                                        <div
                                            key={email.id}
                                            className={cn(
                                                "rounded-lg border transition-all duration-200",
                                                selectedEmailId === email.id
                                                    ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-md"
                                                    : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                                            )}
                                        >
                                            {/* 邮箱信息行 */}
                                            <div className="p-4">
                                                <div className="flex items-center justify-between">
                                                    <div
                                                        className="flex-1 cursor-pointer"
                                                        onClick={() => {
                                                            setSelectedEmailId(email.id)
                                                            setSelectedEmail(null)
                                                        }}
                                                    >
                                                        <div className="flex items-center space-x-3">
                                                            <Mail className="h-5 w-5 text-gray-400" />
                                                            <div className="flex-1">
                                                                <p className="font-mono text-sm font-medium text-gray-900 dark:text-white">
                                                                    {email.email}
                                                                </p>
                                                                {email.isListening && (
                                                                    <div className="flex items-center mt-1 text-xs text-gray-500 dark:text-gray-400">
                                                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                                                        <span>检查 {email.checksPerformed} 次 · {formatDuration(email.elapsedTime)}</span>
                                                                    </div>
                                                                )}
                                                                {email.receivedEmails.length > 0 && (
                                                                    <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                                                                        收到 {email.receivedEmails.length} 封邮件
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center space-x-2">
                                                        <button
                                                            onClick={() => copyEmail(email.email, email.id)}
                                                            className="p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 rounded-lg transition-colors"
                                                        >
                                                            {copiedId === email.id ? (
                                                                <Check className="h-4 w-4 text-green-600" />
                                                            ) : (
                                                                <Copy className="h-4 w-4" />
                                                            )}
                                                        </button>
                                                        <button
                                                            onClick={() => toggleConfig(email.id)}
                                                            className="p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 rounded-lg transition-colors"
                                                        >
                                                            <Settings className={cn(
                                                                "h-4 w-4 transition-transform",
                                                                email.showConfig && "rotate-90"
                                                            )} />
                                                        </button>
                                                        <button
                                                            onClick={() => email.isListening ? stopListening(email.id) : startListening(email.id)}
                                                            className={cn(
                                                                "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                                                                email.isListening
                                                                    ? "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/20 dark:text-red-400"
                                                                    : "bg-primary-100 text-primary-700 hover:bg-primary-200 dark:bg-primary-900/20 dark:text-primary-400"
                                                            )}
                                                        >
                                                            {email.isListening ? (
                                                                <>
                                                                    <Square className="mr-1 inline h-3 w-3" />
                                                                    停止
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Play className="mr-1 inline h-3 w-3" />
                                                                    监听
                                                                </>
                                                            )}
                                                        </button>
                                                        <button
                                                            onClick={() => removeMonitoredEmail(email.id)}
                                                            className="p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 配置面板 */}
                                            {email.showConfig && (
                                                <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/50">
                                                    <div className="grid grid-cols-2 gap-3 mb-3">
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                超时时间（秒）
                                                            </label>
                                                            <input
                                                                type="number"
                                                                value={email.config.timeout}
                                                                onChange={(e) => updateConfig(email.id, { timeout: parseInt(e.target.value) || 300 })}
                                                                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                检查间隔（秒）
                                                            </label>
                                                            <input
                                                                type="number"
                                                                value={email.config.interval}
                                                                onChange={(e) => updateConfig(email.id, { interval: parseInt(e.target.value) || 5 })}
                                                                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* 开始时间选择 */}
                                                    <div className="mb-3">
                                                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                            <Calendar className="inline h-3 w-3 mr-1" />
                                                            开始时间
                                                        </label>
                                                        <input
                                                            type="datetime-local"
                                                            value={formatDateTimeLocal(email.config.startTime || new Date().toISOString())}
                                                            onChange={(e) => {
                                                                const date = new Date(e.target.value)
                                                                updateConfig(email.id, { startTime: date.toISOString() })
                                                            }}
                                                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
                                                        />
                                                    </div>

                                                    {/* 提取器配置 */}
                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                                提取器配置
                                                            </label>
                                                            <button
                                                                onClick={() => addExtractRule(email.id)}
                                                                className="p-1 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded"
                                                            >
                                                                <Plus className="h-3 w-3" />
                                                            </button>
                                                        </div>

                                                        {/* 选择现有提取器模板 */}
                                                        <div className="mb-3">
                                                            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                                                                选择提取器模板
                                                            </label>
                                                            <div className="relative" ref={extractorDropdownRef}>
                                                                <div className="relative">
                                                                    <input
                                                                        type="text"
                                                                        value={extractorSearchTerm}
                                                                        onChange={(e) => {
                                                                            setExtractorSearchTerm(e.target.value)
                                                                            setShowExtractorDropdown(true)
                                                                        }}
                                                                        onFocus={() => setShowExtractorDropdown(true)}
                                                                        placeholder="搜索提取器模板..."
                                                                        className="w-full rounded border border-gray-300 px-2 py-1 pr-8 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
                                                                    />
                                                                    <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                                                                </div>

                                                                {/* 下拉列表 */}
                                                                {showExtractorDropdown && filteredExtractorTemplates.length > 0 && (
                                                                    <div className="absolute z-50 mt-1 w-full rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800 max-h-40 overflow-y-auto">
                                                                        {filteredExtractorTemplates.map((template) => (
                                                                            <button
                                                                                key={template.id}
                                                                                onClick={() => applyExtractorTemplate(email.id, template)}
                                                                                className="w-full px-2 py-1 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                                                            >
                                                                                <div className="font-medium">{template.name}</div>
                                                                                {template.description && (
                                                                                    <div className="text-gray-500 dark:text-gray-400 text-xs truncate">
                                                                                        {template.description}
                                                                                    </div>
                                                                                )}
                                                                                <div className="text-gray-400 text-xs">
                                                                                    {template.extractors.length} 个提取器
                                                                                </div>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* 自定义提取规则 */}
                                                        <div className="mb-2">
                                                            <label className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                                自定义提取规则
                                                            </label>
                                                        </div>
                                                        {email.config.extract.map((rule, index) => (
                                                            <div key={index} className="mb-2 p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                                                                <div className="grid grid-cols-3 gap-2 mb-1">
                                                                    <select
                                                                        value={rule.field}
                                                                        onChange={(e) => updateExtractRule(email.id, index, 'field', e.target.value)}
                                                                        className="rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                                                                    >
                                                                        <option value="ALL">全部</option>
                                                                        <option value="from">发件人</option>
                                                                        <option value="subject">主题</option>
                                                                        <option value="body">正文</option>
                                                                        <option value="html_body">HTML正文</option>
                                                                    </select>
                                                                    <select
                                                                        value={rule.type}
                                                                        onChange={(e) => updateExtractRule(email.id, index, 'type', e.target.value)}
                                                                        className="rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700"
                                                                    >
                                                                        <option value="regex">正则表达式</option>
                                                                        <option value="js">JavaScript</option>
                                                                        <option value="gotemplate">Go模板</option>
                                                                    </select>
                                                                    <button
                                                                        onClick={() => removeExtractRule(email.id, index)}
                                                                        className="text-red-600 hover:text-red-700 text-xs"
                                                                    >
                                                                        删除
                                                                    </button>
                                                                </div>
                                                                <input
                                                                    type="text"
                                                                    value={rule.extract}
                                                                    onChange={(e) => updateExtractRule(email.id, index, 'extract', e.target.value)}
                                                                    placeholder="提取表达式"
                                                                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700"
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* 错误提示 */}
                            {error && (
                                <div className="rounded-lg bg-red-50 p-4 dark:bg-red-900/20">
                                    <div className="flex items-center">
                                        <AlertCircle className="mr-2 h-5 w-5 text-red-600" />
                                        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                                        <button
                                            onClick={() => setError(null)}
                                            className="ml-auto text-red-600 hover:text-red-700"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* 右侧面板 - 邮件列表/详情 */}
            <div className="flex-1 flex flex-col p-6 overflow-hidden">
                {selectedMonitoredEmail ? (
                    selectedEmail ? (
                        // 邮件详情视图
                        <div className="h-full flex flex-col overflow-hidden">
                            {/* 返回按钮 */}
                            <button
                                onClick={() => setSelectedEmail(null)}
                                className="mb-4 flex items-center text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 flex-shrink-0"
                            >
                                <ArrowLeft className="h-4 w-4 mr-1" />
                                返回邮件列表
                            </button>

                            {/* 邮件内容 */}
                            <div className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col">
                                {/* 邮件头部 */}
                                <div className="bg-gray-50 dark:bg-gray-800 p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                                                {selectedEmail.Subject || '(无主题)'}
                                            </h3>
                                            <div className="flex items-center space-x-2">
                                                <button
                                                    onClick={() => setViewMode('html')}
                                                    className={cn(
                                                        "p-2 rounded transition-colors",
                                                        viewMode === 'html'
                                                            ? "bg-primary-100 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400"
                                                            : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                                                    )}
                                                    title="HTML视图"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => setViewMode('text')}
                                                    className={cn(
                                                        "p-2 rounded transition-colors",
                                                        viewMode === 'text'
                                                            ? "bg-primary-100 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400"
                                                            : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                                                    )}
                                                    title="纯文本视图"
                                                >
                                                    <FileText className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => setViewMode('raw')}
                                                    className={cn(
                                                        "p-2 rounded transition-colors",
                                                        viewMode === 'raw'
                                                            ? "bg-primary-100 text-primary-700 dark:bg-primary-900/20 dark:text-primary-400"
                                                            : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                                                    )}
                                                    title="原始内容"
                                                >
                                                    <Code className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="text-sm text-gray-600 dark:text-gray-400">
                                            <p>发件人: {Array.isArray(selectedEmail.From) ? selectedEmail.From.join(', ') : selectedEmail.From}</p>
                                            <p>时间: {formatDate(selectedEmail.Date)}</p>
                                        </div>
                                    </div>
                                </div>

                                {/* 邮件正文 */}
                                <div className="flex-1 bg-white dark:bg-gray-900 p-4 overflow-auto">
                                    {viewMode === 'html' && selectedEmail.HTMLBody ? (
                                        <iframe
                                            srcDoc={selectedEmail.HTMLBody}
                                            title="邮件内容"
                                            className="w-full h-full border-0 bg-white dark:bg-gray-800"
                                            sandbox="allow-same-origin allow-popups"
                                        />
                                    ) : viewMode === 'text' ? (
                                        <pre className="whitespace-pre-wrap text-sm text-gray-900 dark:text-white font-sans overflow-auto h-full">
                                            {selectedEmail.Body || '(无文本内容)'}
                                        </pre>
                                    ) : (
                                        <pre className="whitespace-pre-wrap text-xs text-gray-700 dark:text-gray-300 font-mono overflow-auto h-full">
                                            {JSON.stringify(selectedEmail, null, 2)}
                                        </pre>
                                    )}
                                </div>

                                {/* 提取的数据 */}
                                {(() => {
                                    const emailIndex = selectedMonitoredEmail.receivedEmails.findIndex(e => e.ID === selectedEmail.ID)
                                    const extractedData = selectedMonitoredEmail.extractedData[emailIndex]
                                    return extractedData && Object.keys(extractedData).length > 0 ? (
                                        <div className="border-t border-gray-200 dark:border-gray-700 bg-green-50 dark:bg-green-900/20 p-4 flex-shrink-0">
                                            <h4 className="text-sm font-medium text-green-800 dark:text-green-300 mb-2">
                                                提取的数据
                                            </h4>
                                            <pre className="text-xs text-green-700 dark:text-green-400 overflow-auto max-h-32">
                                                {JSON.stringify(extractedData, null, 2)}
                                            </pre>
                                        </div>
                                    ) : null
                                })()}
                            </div>
                        </div>
                    ) : (
                        // 邮件列表视图
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                                {selectedMonitoredEmail.email} 的邮件
                            </h2>
                            {selectedMonitoredEmail.receivedEmails.length > 0 ? (
                                <div className="space-y-2">
                                    {selectedMonitoredEmail.receivedEmails.map((email, index) => (
                                        <div
                                            key={email.ID}
                                            onClick={() => setSelectedEmail(email)}
                                            className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-all"
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center space-x-2 mb-1">
                                                        <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                                                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                                            {email.Subject || '(无主题)'}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                                                        {Array.isArray(email.From) ? email.From.join(', ') : email.From}
                                                    </p>
                                                    {email.Body && (
                                                        <p className="text-sm text-gray-500 dark:text-gray-500 mt-1 line-clamp-2">
                                                            {email.Body}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="flex-shrink-0 text-right">
                                                    <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                                        {formatDate(email.Date)}
                                                    </p>
                                                    {selectedMonitoredEmail.extractedData[index] && (
                                                        <span className="inline-flex items-center px-2 py-1 mt-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400">
                                                            已提取
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                                    <Inbox className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                    <p>还没有收到邮件</p>
                                    {!selectedMonitoredEmail.isListening && (
                                        <p className="text-sm mt-1">点击"监听"按钮开始接收邮件</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                ) : (
                    <div className="h-full flex items-center justify-center overflow-auto">
                        <div className="text-center">
                            <Mail className="h-16 w-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                            <p className="text-lg text-gray-500 dark:text-gray-400">
                                选择一个邮箱查看邮件
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* 同步配置模态框 */}
            {showSyncConfigModal && (
                <CreateSyncConfigModal
                    isOpen={showSyncConfigModal}
                    onClose={() => setShowSyncConfigModal(false)}
                    accountId={syncConfigAccountId}
                    accountEmail={syncConfigAccountEmail}
                    onSuccess={(config) => {
                        logger.debug('[监听] 同步配置创建成功:', config);
                        setShowSyncConfigModal(false);
                        // 重新尝试开始监听
                        const monitoredEmail = monitoredEmails.find(m => m.email === syncConfigAccountEmail);
                        if (monitoredEmail) {
                            startListening(monitoredEmail.id);
                        }
                    }}
                />
            )}
        </div>
    )
}
