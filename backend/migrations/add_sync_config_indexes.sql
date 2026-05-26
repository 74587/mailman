-- 添加同步配置优化索引
-- 用于快速查询配置变更和监控

-- 1. 添加updated_at索引，用于快速查询最近更新的配置
CREATE INDEX IF NOT EXISTS idx_email_account_sync_configs_updated_at
ON email_account_sync_configs(updated_at);

-- 2. 添加enable_auto_sync索引，用于快速查询启用的配置
CREATE INDEX IF NOT EXISTS idx_email_account_sync_configs_enabled
ON email_account_sync_configs(enable_auto_sync);

-- 3. 添加复合索引，用于同时过滤启用状态和更新时间
CREATE INDEX IF NOT EXISTS idx_email_account_sync_configs_enabled_updated
ON email_account_sync_configs(enable_auto_sync, updated_at);

-- 4. 添加account_id索引，用于快速查询特定账户的配置
CREATE INDEX IF NOT EXISTS idx_email_account_sync_configs_account_id
ON email_account_sync_configs(account_id);

-- 5. 为emails表添加account_id和date的复合索引，优化邮件查询
CREATE INDEX IF NOT EXISTS idx_emails_account_date
ON emails(account_id, date DESC);

-- 6. 为emails表添加message_id和account_id的复合索引，优化去重查询
CREATE INDEX IF NOT EXISTS idx_emails_message_account
ON emails(message_id, account_id);

COMMENT ON INDEX idx_email_account_sync_configs_updated_at IS '同步配置更新时间索引，用于配置变更监控';
COMMENT ON INDEX idx_email_account_sync_configs_enabled IS '同步配置启用状态索引，用于快速过滤启用的配置';
COMMENT ON INDEX idx_email_account_sync_configs_enabled_updated IS '同步配置启用状态和更新时间复合索引';
COMMENT ON INDEX idx_email_account_sync_configs_account_id IS '同步配置账户ID索引';
COMMENT ON INDEX idx_emails_account_date IS '邮件账户和日期复合索引，优化邮件查询';
COMMENT ON INDEX idx_emails_message_account IS '邮件MessageID和账户ID复合索引，优化去重查询';
