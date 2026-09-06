-- ============================================================
-- 0057_platform_accounts.sql —— 平台授权中心地基（P2e-1）
--
-- 背景：调研报告 reports/superman-publish-auth-research.md §C。
--   扫码 cookie 类与 API 密钥类账号统一落 platform_accounts（多账号：
--   不以 platform 为唯一键，而是 (user_id, platform, account_name)）。
--   官方 OAuth 类走 oauth hub（oauth_connections），本表不覆盖。
--
-- 新表：
--   platform_accounts：
--     cred_kind 区分凭据形态：app_secret（公众号 appid+secret JSON）/
--       cookie（扫码 cookie JSON）/ oauth（引用 oauth hub，预留）。
--     credential_encrypted 一律 secretBox（v1:iv:tag:ct）；
--     credential_masked 只存打码快照（前4****后4），明文永不落库、永不回显。
--     status: active / expired / error（巡检/verify 回写）。
--
-- 迁移安全性：全部 if not exists，幂等；回滚 drop 新表即可。
-- ============================================================

create table if not exists platform_accounts (
  id                   bigserial   primary key,
  user_id              bigint      not null references users(id) on delete cascade,
  platform             text        not null,
  account_name         text        not null default '',
  cred_kind            text        not null,
  credential_encrypted text        not null default '',
  credential_masked    text        not null default '',
  status               text        not null default 'active',
  expires_at           timestamptz,
  last_verified_at     timestamptz,
  meta_json            jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint platform_accounts_platform_check
    check (platform in ('wechat', 'douyin', 'xhs', 'bilibili', 'channels')),
  constraint platform_accounts_cred_kind_check
    check (cred_kind in ('app_secret', 'cookie', 'oauth')),
  constraint platform_accounts_status_check
    check (status in ('active', 'expired', 'error'))
);

create unique index if not exists idx_platform_accounts_user_platform_name
  on platform_accounts (user_id, platform, account_name);

create index if not exists idx_platform_accounts_user_platform
  on platform_accounts (user_id, platform, status);
