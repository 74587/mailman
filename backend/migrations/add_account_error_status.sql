-- 添加账户异常状态字段
-- 用于标记OAuth2认证失败等异常情况

-- 1. 为email_accounts表添加异常状态字段
ALTER TABLE email_accounts
ADD COLUMN error_status VARCHAR(50) DEFAULT 'normal';

ALTER TABLE email_accounts
ADD COLUMN error_message TEXT DEFAULT '';

ALTER TABLE email_accounts
ADD COLUMN error_timestamp TIMESTAMP NULL;

ALTER TABLE email_accounts
ADD COLUMN error_count INTEGER DEFAULT 0;

ALTER TABLE email_accounts
ADD COLUMN auto_disabled_at TIMESTAMP NULL;

-- 2. 为email_account_sync_configs表添加异常相关字段
ALTER TABLE email_account_sync_configs
ADD COLUMN auto_disabled BOOLEAN DEFAULT FALSE;

ALTER TABLE email_account_sync_configs
ADD COLUMN disable_reason VARCHAR(255) DEFAULT '';

ALTER TABLE email_account_sync_configs
ADD COLUMN consecutive_errors INTEGER DEFAULT 0;

ALTER TABLE email_account_sync_configs
ADD COLUMN last_error_time TIMESTAMP NULL;

-- 3. 添加索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_email_accounts_error_status
ON email_accounts(error_status);

CREATE INDEX IF NOT EXISTS idx_email_account_sync_configs_auto_disabled
ON email_account_sync_configs(auto_disabled);

CREATE INDEX IF NOT EXISTS idx_email_account_sync_configs_consecutive_errors
ON email_account_sync_configs(consecutive_errors);

-- 4. 添加注释
COMMENT ON COLUMN email_accounts.error_status IS '账户错误状态: normal, oauth_expired, auth_revoked, api_disabled, network_error';
COMMENT ON COLUMN email_accounts.error_message IS '详细错误信息';
COMMENT ON COLUMN email_accounts.error_timestamp IS '最后错误发生时间';
COMMENT ON COLUMN email_accounts.error_count IS '累计错误次数';
COMMENT ON COLUMN email_accounts.auto_disabled_at IS '自动禁用时间';

COMMENT ON COLUMN email_account_sync_configs.auto_disabled IS '是否因错误自动禁用同步';
COMMENT ON COLUMN email_account_sync_configs.disable_reason IS '自动禁用原因';
COMMENT ON COLUMN email_account_sync_configs.consecutive_errors IS '连续错误次数';
COMMENT ON COLUMN email_account_sync_configs.last_error_time IS '最后错误时间';
